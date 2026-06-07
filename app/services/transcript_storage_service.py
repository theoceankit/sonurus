import os
import sqlite3
from datetime import datetime, date, timedelta

from app.models.transcript import Transcript
from app.models.segment import Segment
from app.logger import get_logger
from app.db.schema import init_db
from app.db.serializers import serialize_embedding, deserialize_embedding

log = get_logger("DB")


class TranscriptStorageService:
    def __init__(self, db_path="speaker_memory.db"):
        self.db_path = db_path
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            init_db(conn)

    # ── Write ─────────────────────────────────────────────────────────────────

    def save(self, transcript: Transcript) -> int:
        """Insert transcript + segments, set transcript.db_id. Returns new id."""
        with self._connect() as conn:
            cursor = conn.execute(
                "INSERT INTO transcriptions (audio_file, language, status, created_at, title) VALUES (?, ?, ?, ?, ?)",
                (transcript.audio_path, transcript.language,
                 transcript.status, datetime.now().isoformat(), transcript.title),
            )
            db_id = cursor.lastrowid

            conn.executemany(
                """INSERT INTO segments
                       (transcription_id, speaker_id, start, end, text, speaker_raw, embedding)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        db_id,
                        seg.speaker_final or seg.speaker_resolved,
                        seg.start, seg.end, seg.text, seg.speaker_raw,
                        serialize_embedding(seg.embedding),
                    )
                    for seg in transcript.segments
                ],
            )

        log.info(f"INSERT transcriptions id={db_id} audio={transcript.audio_path}")
        log.info(f"INSERT segments {len(transcript.segments)} rows for transcription {db_id}")
        transcript.db_id = db_id
        return db_id

    def update_segments_speaker(self, db_id: int, from_spk: str, to_spk: str) -> None:
        """Reassign all segments of from_spk to to_spk within a transcription."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE segments SET speaker_id = ? WHERE transcription_id = ? AND speaker_id = ?",
                (to_spk, db_id, from_spk),
            )
        log.info(f"UPDATE segments speaker_id={to_spk} where transcription={db_id} from={from_spk}")

    def update_segment_speaker(self, db_id: int, start: float, end: float, new_speaker: str) -> None:
        """Reassign a single segment's speaker identified by its time range."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE segments SET speaker_id = ? WHERE transcription_id = ? AND start = ? AND end = ?",
                (new_speaker, db_id, start, end),
            )
        log.info(f"UPDATE segments speaker_id={new_speaker} at [{start:.2f}-{end:.2f}] for transcription={db_id}")

    def update_segment_text(self, db_id: int, start: float, end: float, new_text: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE segments SET text = ? WHERE transcription_id = ? AND start = ? AND end = ?",
                (new_text, db_id, start, end)
            )
        log.info(f"Updated segment text for transcription {db_id}")

    def delete_segment(self, db_id: int, start: float, end: float) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM segments WHERE transcription_id = ? AND start = ? AND end = ?",
                (db_id, start, end)
            )
        log.info(f"Deleted segment from transcription {db_id}")

    def delete(self, db_id: int) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM segments WHERE transcription_id = ?", (db_id,))
            conn.execute("DELETE FROM transcriptions WHERE id = ?", (db_id,))
        log.info(f"DELETE transcription id={db_id} and its segments")

    # ── Read ──────────────────────────────────────────────────────────────────

    def load(self, db_id: int) -> Transcript:
        """Load a full Transcript from DB by id."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT audio_file, language, status, title FROM transcriptions WHERE id = ?",
                (db_id,),
            ).fetchone()

            if not row:
                raise ValueError(f"Transcription {db_id} not found")

            audio_file, language, status, title_db = row
            log.info(f"SELECT transcriptions id={db_id}")

            seg_rows = conn.execute(
                """SELECT start, end, text, speaker_raw, speaker_id, embedding
                   FROM segments
                   WHERE transcription_id = ?
                   ORDER BY start""",
                (db_id,),
            ).fetchall()

        log.info(f"SELECT segments {len(seg_rows)} rows for transcription {db_id}")
        segments = [
            Segment(
                start=r[0], end=r[1], text=r[2],
                speaker_raw=r[3] or "",
                speaker_resolved=r[4],
                embedding=deserialize_embedding(r[5]),
            )
            for r in seg_rows
        ]

        return Transcript(
            segments=segments,
            audio_path=audio_file,
            language=language or "",
            status=status or "draft",
            title=title_db,
            db_id=db_id,
        )

    def list_all(self) -> list[dict]:
        """Return recording metadata for sidebar, newest first."""
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT t.id,
                          t.audio_file,
                          t.title,
                          t.created_at,
                          t.status,
                          MAX(s.end)                         AS duration_sec,
                          GROUP_CONCAT(DISTINCT s.speaker_id) AS speaker_ids
                   FROM transcriptions t
                   LEFT JOIN segments s ON s.transcription_id = t.id
                   GROUP BY t.id
                   ORDER BY t.created_at DESC""",
            ).fetchall()

        today     = date.today()
        yesterday = today - timedelta(days=1)
        last_week = today - timedelta(days=7)

        records = []
        for r in rows:
            db_id, audio_file, title_db, created_at_str, status, duration_sec, speaker_ids_str = r

            created = date.fromisoformat(created_at_str[:10]) if created_at_str else today
            if created == today:
                section = "Today"
            elif created == yesterday:
                section = "Yesterday"
            elif created >= last_week:
                section = "Last week"
            else:
                section = created.strftime("%b %d, %Y")

            speaker_ids = [s for s in (speaker_ids_str or "").split(",") if s]
            duration_str = _fmt_duration(duration_sec or 0)
            title = title_db or os.path.splitext(os.path.basename(audio_file))[0]

            records.append({
                "id":         db_id,
                "title":      title,
                "created_at": created_at_str or "",
                "section":    section,
                "status":     status,
                "duration":   duration_str,
                "speakers":   speaker_ids,
            })

        return records

    def get_embeddings_by_speaker(self, speaker_id: str) -> list:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT embedding FROM segments WHERE speaker_id = ? AND embedding IS NOT NULL",
                (speaker_id,)
            ).fetchall()
        return [deserialize_embedding(r[0]) for r in rows]

    def get_embeddings_grouped_by_transcript(self, speaker_id: str) -> dict:
        """Return {transcription_id: [embeddings]} for all non-null segment embeddings.

        Used by CommitService to give each recording equal weight when averaging,
        regardless of how many segments it contains.
        """
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT transcription_id, embedding FROM segments "
                "WHERE speaker_id = ? AND embedding IS NOT NULL",
                (speaker_id,)
            ).fetchall()
        grouped: dict[int, list] = {}
        for tid, blob in rows:
            grouped.setdefault(tid, []).append(deserialize_embedding(blob))
        return grouped


def _fmt_duration(seconds: float) -> str:
    mins = int(seconds) // 60
    return f"{mins} min" if mins < 60 else f"{mins // 60}h {mins % 60}m"
