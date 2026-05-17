import re
import sqlite3
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import uuid

from app.config import SPEAKER_SIMILARITY_THRESHOLD
from app.logger import get_logger

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

log = get_logger("SpeakerMemoryService")


class SpeakerMemoryService:
    """
    Service for managing speaker identity across sessions.

    Speaker embeddings are persisted in a SQLite database.
    resolve() is a pure function — it never mutates known_speakers.
    Only CommitService.commit() writes to memory via update_embedding() + save().
    """

    def __init__(self, db_path="speaker_memory.db", threshold=SPEAKER_SIMILARITY_THRESHOLD):
        self.db_path = db_path
        self.threshold = threshold
        self._init_db()
        self.known_speakers, self.known_counts = self._load()
        self.known_names = self._load_names()
        self._dirty: set[str] = set()
        log.info(f"Loaded {len(self.known_speakers)} known speakers")

    def resolve(self, new_embeddings: dict) -> dict:
        """
        Matches new speakers against known ones using exclusive greedy assignment.

        Each known speaker can be claimed by at most one new speaker per session.
        Candidates are ranked by cosine similarity; the best score wins.

        Returns: {SPEAKER_XX: uuid4}
        Does NOT mutate known_speakers.
        """
        log.info(f"Resolving {len(new_embeddings)} speakers against {len(self.known_speakers)} known profiles")
        resolved = {}

        candidates = []
        for speaker_id, emb in new_embeddings.items():
            for known_name, known_emb in self.known_speakers.items():
                score = cosine_similarity(
                    emb.reshape(1, -1),
                    known_emb.reshape(1, -1)
                )[0][0]
                candidates.append((score, speaker_id, known_name))

        candidates.sort(reverse=True)

        assigned_new = set()
        assigned_known = set()

        for score, speaker_id, known_name in candidates:
            if score < self.threshold:
                break
            if speaker_id in assigned_new or known_name in assigned_known:
                continue
            resolved[speaker_id] = known_name
            assigned_new.add(speaker_id)
            assigned_known.add(known_name)
            log.info(f"{speaker_id} → {known_name} (similarity {score:.2f})")

        for speaker_id in new_embeddings:
            if speaker_id not in resolved:
                new_name = self._generate_new_speaker_id()
                log.info(f"{speaker_id} → {new_name} (new)")
                resolved[speaker_id] = new_name

        return resolved

    def update_embedding(self, spk_id: str, embedding: np.ndarray, count: int = 1):
        norm = np.linalg.norm(embedding)
        self.known_speakers[spk_id] = embedding / norm if norm > 0 else embedding
        self.known_counts[spk_id] = count
        self._dirty.add(spk_id)

    def get_name(self, spk_id: str, label: str = "display") -> str | None:
        return self.known_names.get(spk_id, {}).get(label)

    def set_name(self, spk_id: str, name: str, label: str = "display"):
        if spk_id not in self.known_names:
            self.known_names[spk_id] = {}
        self.known_names[spk_id][label] = name

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def save(self):
        """Persists to SQLite.

        Embeddings: only speakers marked dirty by update_embedding() — prevents
        a long-lived instance with stale in-memory state from overwriting
        embeddings computed by a concurrent pipeline instance.
        Names: all speakers present in both known_names and known_speakers, so
        that set_name() + save() works without requiring a prior update_embedding().
        """
        dirty = self._dirty
        speakers_with_names = [s for s in self.known_names if s in self.known_speakers]
        if not dirty and not speakers_with_names:
            return
        with self._connect() as conn:
            if dirty:
                conn.executemany(
                    "INSERT OR REPLACE INTO speaker_embeddings (id, embedding, count) VALUES (?, ?, ?)",
                    [
                        (spk_id, self.known_speakers[spk_id].astype(np.float32).tobytes(),
                         self.known_counts.get(spk_id, 1))
                        for spk_id in dirty
                        if spk_id in self.known_speakers
                    ]
                )
            for spk_id in speakers_with_names:
                conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.executemany(
                "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
                [
                    (spk_id, label, name)
                    for spk_id in speakers_with_names
                    for label, name in self.known_names[spk_id].items()
                ]
            )
        self._dirty = set()
        log.info(f"Saved {len(self.known_speakers)} speakers → {self.db_path}")

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            # migrate legacy table name
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if "speakers" in tables and "speaker_embeddings" not in tables:
                conn.execute("ALTER TABLE speakers RENAME TO speaker_embeddings")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS speaker_embeddings (
                    id        TEXT PRIMARY KEY,
                    embedding BLOB NOT NULL,
                    count     INTEGER NOT NULL DEFAULT 1
                )
            """)
            # migrate: add count column to existing databases
            try:
                conn.execute("ALTER TABLE speaker_embeddings ADD COLUMN count INTEGER NOT NULL DEFAULT 1")
            except sqlite3.OperationalError:
                pass  # column already exists

            conn.execute("""
                CREATE TABLE IF NOT EXISTS speaker_names (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    speaker_id TEXT NOT NULL REFERENCES speaker_embeddings(id),
                    label      TEXT NOT NULL,
                    name       TEXT NOT NULL
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS _meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                )
            """)

            already_done = conn.execute(
                "SELECT value FROM _meta WHERE key='m001_uuid_speakers'"
            ).fetchone()
            if not already_done:
                all_rows = conn.execute(
                    "SELECT id, embedding, count FROM speaker_embeddings"
                ).fetchall()
                legacy_rows = [
                    (row_id, embedding, count)
                    for row_id, embedding, count in all_rows
                    if not row_id.startswith('spk_')
                    and not row_id.startswith('SPEAKER_')
                    and not _UUID_RE.match(row_id)
                ]
                for (old_id, _, _) in legacy_rows:
                    new_id = self._generate_new_speaker_id()
                    conn.execute(
                        "UPDATE speaker_embeddings SET id = ? WHERE id = ?",
                        (new_id, old_id),
                    )
                    conn.execute(
                        "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
                        (new_id, "display", old_id),
                    )
                    conn.execute(
                        "UPDATE segments SET speaker_id = ? WHERE speaker_id = ?",
                        (new_id, old_id),
                    )
                conn.execute(
                    "INSERT INTO _meta (key, value) VALUES ('m001_uuid_speakers', 'done')"
                )

    def _load(self) -> tuple[dict, dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT id, embedding, count FROM speaker_embeddings").fetchall()
        speakers = {}
        counts = {}
        for spk_id, blob, count in rows:
            speakers[spk_id] = np.frombuffer(blob, dtype=np.float32).copy()
            counts[spk_id] = count
        return speakers, counts

    def _load_names(self) -> dict:
        with self._connect() as conn:
            rows = conn.execute("SELECT speaker_id, label, name FROM speaker_names").fetchall()
        result = {}
        for spk_id, label, name in rows:
            if spk_id not in result:
                result[spk_id] = {}
            result[spk_id][label] = name
        return result

    def save_names_only(self):
        """Persists known_names to speaker_names without touching speaker_embeddings."""
        with self._connect() as conn:
            existing_ids = {
                r[0] for r in conn.execute("SELECT id FROM speaker_embeddings").fetchall()
            }
            speakers_to_write = [
                spk_id for spk_id in self.known_names
                if spk_id in existing_ids
            ]
            for spk_id in speakers_to_write:
                conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.executemany(
                "INSERT INTO speaker_names (speaker_id, label, name) VALUES (?, ?, ?)",
                [
                    (spk_id, label, name)
                    for spk_id in speakers_to_write
                    for label, name in self.known_names[spk_id].items()
                ]
            )

    def find_by_name(self, name: str, label: str = "display") -> str | None:
        """Returns the speaker UUID for the given display name, or None if not found."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT speaker_id FROM speaker_names WHERE name = ? AND label = ?",
                (name, label),
            ).fetchone()
        return row[0] if row else None

    def remove_speaker(self, spk_id: str):
        """Remove a speaker from memory and the database. No-op if not present."""
        if spk_id not in self.known_speakers:
            return
        del self.known_speakers[spk_id]
        self.known_counts.pop(spk_id, None)
        self.known_names.pop(spk_id, None)
        with self._connect() as conn:
            conn.execute("DELETE FROM speaker_names WHERE speaker_id = ?", (spk_id,))
            conn.execute("DELETE FROM speaker_embeddings WHERE id = ?", (spk_id,))

    @staticmethod
    def _generate_new_speaker_id():
        return str(uuid.uuid4())
