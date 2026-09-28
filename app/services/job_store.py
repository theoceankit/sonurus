"""SQLite persistence for the transcription queue.

Jobs and queue settings live in the same database file as transcripts
(DB_PATH) but in their own tables, created here. The queue survives a
restart; which job is running and whether the queue is paused are not
stored (see TranscriptionQueue for the state at start-up).
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime

_FIELDS = ("id", "audio_path", "title", "whisper_model", "language", "status",
           "error", "error_code", "error_language", "created_at")
_EDITABLE = {"title", "whisper_model", "language", "status", "error", "error_code", "error_language"}


class JobStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transcription_jobs (
                    id             TEXT PRIMARY KEY,
                    position       INTEGER NOT NULL,
                    audio_path     TEXT NOT NULL,
                    title          TEXT NOT NULL,
                    whisper_model  TEXT NOT NULL,
                    language       TEXT,
                    status         TEXT NOT NULL DEFAULT 'waiting',
                    error          TEXT,
                    error_code     TEXT,
                    error_language TEXT,
                    created_at     TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transcription_queue_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _job(row) -> dict:
        return {f: row[f] for f in _FIELDS}

    # ── Jobs ────────────────────────────────────────────────────────────────

    def add(self, audio_path: str, title: str, whisper_model: str, language: str | None) -> dict:
        job_id = str(uuid.uuid4())
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO transcription_jobs "
                "(id, position, audio_path, title, whisper_model, language, created_at) "
                "VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM transcription_jobs), ?, ?, ?, ?, ?)",
                (job_id, audio_path, title, whisper_model, language, datetime.now().isoformat()),
            )
        return self.get(job_id)

    def get(self, job_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM transcription_jobs WHERE id = ?", (job_id,)).fetchone()
        return self._job(row) if row else None

    def list(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM transcription_jobs ORDER BY position").fetchall()
        return [self._job(r) for r in rows]

    def update(self, job_id: str, **fields) -> None:
        unknown = set(fields) - _EDITABLE
        if unknown:
            raise ValueError(f"Not editable: {', '.join(sorted(unknown))}")
        if not fields:
            return
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._connect() as conn:
            conn.execute(f"UPDATE transcription_jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))

    def move_to_end(self, job_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE transcription_jobs "
                "SET position = (SELECT MAX(position) + 1 FROM transcription_jobs) WHERE id = ?",
                (job_id,),
            )

    def reorder(self, job_ids: list[str]) -> None:
        """Set the order of all jobs; job_ids must be exactly the current jobs."""
        with self._connect() as conn:
            current = {r[0] for r in conn.execute("SELECT id FROM transcription_jobs")}
            if len(job_ids) != len(set(job_ids)) or set(job_ids) != current:
                raise ValueError("job_ids must list every job in the queue exactly once")
            conn.executemany("UPDATE transcription_jobs SET position = ? WHERE id = ?",
                             [(i, job_id) for i, job_id in enumerate(job_ids)])

    def delete(self, job_id: str) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM transcription_jobs WHERE id = ?", (job_id,)).rowcount > 0

    def reset_running(self) -> int:
        """A job left 'running' was interrupted (backend stopped): run it again."""
        with self._connect() as conn:
            return conn.execute(
                "UPDATE transcription_jobs SET status = 'waiting' WHERE status = 'running'"
            ).rowcount

    def clear(self) -> int:
        with self._connect() as conn:
            return conn.execute("DELETE FROM transcription_jobs").rowcount

    def audio_paths(self) -> set[str]:
        with self._connect() as conn:
            return {r[0] for r in conn.execute("SELECT audio_path FROM transcription_jobs")}

    # ── Settings ────────────────────────────────────────────────────────────

    def get_setting(self, key: str, default: str) -> str:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM transcription_queue_settings WHERE key = ?",
                               (key,)).fetchone()
        return row[0] if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute("INSERT OR REPLACE INTO transcription_queue_settings (key, value) VALUES (?, ?)",
                         (key, value))
