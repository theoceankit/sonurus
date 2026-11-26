"""Make the database snapshots of tests/test_db_migrations.py.

Each snapshot is the database a released version leaves behind: the schema
code of that git tag (or commit) creates it, a few rows go in, and the result
is written as SQL. Run from the repository root with the project venv, after a
change to what the snapshots hold (they never change for a new release: add
one for it instead):

    .venv/bin/python tests/fixtures/db/make_snapshots.py

The schema code of every revision runs in its own process, from its own copy
of app/ (git archive), so that no module of this checkout is mixed in.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from io import BytesIO
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

# file name → revision. 0.2.0–0.2.2 share a schema, as do 0.3.2 and what
# follows it up to the single migration chain.
SNAPSHOTS = {
    "v0.2.2.sql": "v0.2.2",
    "v0.3.0.sql": "v0.3.0",
    "v0.3.1.sql": "v0.3.1",
    "v0.3.2.sql": "v0.3.2",
    "e1e24bf.sql": "e1e24bf",
}

SPEAKER = "6f1c2b8e-4a3d-4f7e-9b2a-1c5d8e7f9a01"
EMBEDDING = bytes(range(16))

# Rows per table, columns a revision lacks are left out.
ROWS = {
    "transcriptions": [{"id": 1, "audio_file": "recordings/meeting.wav", "language": "en", "status": "draft",
                        "created_at": "2026-09-01T10:00:00", "title": "Weekly sync", "opened": 1, "diarized": 1}],
    "segments": [
        {"id": 1, "transcription_id": 1, "speaker_id": SPEAKER, "start": 0.0, "end": 2.5,
         "text": "Good morning everyone", "speaker_raw": "SPEAKER_00", "embedding": EMBEDDING, "unassigned": 0},
        {"id": 2, "transcription_id": 1, "speaker_id": None, "start": 2.5, "end": 4.0,
         "text": "Ёлки зелёные", "speaker_raw": None, "embedding": None, "unassigned": 1},
    ],
    "speaker_embeddings": [{"id": SPEAKER, "embedding": EMBEDDING, "count": 3}],
    "speaker_names": [{"id": 1, "speaker_id": SPEAKER, "label": "display", "name": "Anna"}],
    "speaker_meta": [{"speaker_id": SPEAKER, "color_index": 2, "handle": "anna", "handle_manual": 0,
                      "photo": None}],
    "speaker_matches": [{"transcription_id": 1, "speaker_id": SPEAKER, "score": 0.81, "confirmed": 1}],
    "notes": [{"id": 1, "transcription_id": 1, "format": 1, "created_at": "2026-09-01T11:00:00",
               "updated_at": "2026-09-01T11:00:00",
               "content": json.dumps({"type": "doc", "content": [
                   {"type": "paragraph", "content": [{"type": "text", "text": "Ship the release"}]}]})}],
    "transcription_jobs": [{"id": "job-1", "position": 0, "audio_path": "recordings/next.wav", "title": "Next",
                            "whisper_model": "small", "language": None, "status": "waiting", "error": None,
                            "error_code": None, "error_language": None, "created_at": "2026-09-01T12:00:00",
                            "diarize": 1}],
    "transcription_queue_settings": [{"key": "paused", "value": "0"}],
    "app_settings": [{"key": "mcp_enabled", "value": "1"}],
}

# Runs inside the revision's copy of app/: its own services create the schema.
CHILD = """
import sys
db = sys.argv[1]
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
SpeakerMemoryService(db_path=db)
TranscriptStorageService(db_path=db)
from app.services.job_store import JobStore
JobStore(db_path=db)
try:
    from app.services.app_settings import AppSettings
except ImportError:
    pass
else:
    AppSettings(db_path=db)
"""


def _extract(revision: str, into: Path) -> None:
    archive = subprocess.run(["git", "archive", revision, "app"], cwd=ROOT, check=True,
                             capture_output=True).stdout
    with tarfile.open(fileobj=BytesIO(archive)) as tar:
        tar.extractall(into, filter="data")


def _fill(db: Path) -> None:
    conn = sqlite3.connect(db)
    for table, rows in ROWS.items():
        columns = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if not columns:
            continue
        for row in rows:
            row = {k: v for k, v in row.items() if k in columns}
            conn.execute(f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                         list(row.values()))
    # The search index of a revision that has one is filled by its triggers
    # (segments) and by its storage service (titles, notes): fill those two as
    # that service would have.
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'search_titles'").fetchone():
        conn.execute("INSERT INTO search_titles (rowid, text, shown) VALUES (1, 'Weekly sync', 'Weekly sync')")
        conn.execute("INSERT INTO search_notes (text, shown, transcription_id, block) "
                     "VALUES ('Ship the release', 'Ship the release', 1, 0)")
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'note_version_seq'").fetchone():
        conn.execute("UPDATE notes SET version = 1, writer = 'editor'")
        conn.execute("UPDATE note_version_seq SET last = 1")
    conn.commit()
    conn.close()


def _literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return f"X'{value.hex()}'"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def dump(db: Path) -> str:
    """The database as SQL that rebuilds it: tables and their rows, then
    indexes and triggers (after the rows, so that no trigger fires twice).
    FTS5 tables are written as themselves with their rows, not as the shadow
    tables SQLite keeps for them."""
    conn = sqlite3.connect(db)
    entries = conn.execute(
        "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid").fetchall()
    virtual = [name for kind, name, sql in entries if kind == "table" and sql.startswith("CREATE VIRTUAL")]
    shadow = {name for kind, name, _ in entries
              if kind == "table" and any(name.startswith(v + "_") for v in virtual)}
    out = []
    later = []
    for kind, name, sql in entries:
        if name in shadow or name.startswith("sqlite_"):
            continue
        if kind != "table":
            later.append(sql + ";")
            continue
        out.append(sql + ";")
        if name in virtual:
            columns = ["rowid"] + [r[1] for r in conn.execute(f"PRAGMA table_info({name})")]
        else:
            columns = [r[1] for r in conn.execute(f"PRAGMA table_info({name})")]
        for row in conn.execute(f"SELECT {', '.join(columns)} FROM {name} ORDER BY rowid"):
            out.append(f"INSERT INTO {name} ({', '.join(columns)}) VALUES "
                       f"({', '.join(_literal(v) for v in row)});")
    for row in conn.execute("SELECT name, seq FROM sqlite_sequence ORDER BY name") if any(
            name == "sqlite_sequence" for _, name, _ in entries) else []:
        out.append(f"INSERT INTO sqlite_sequence (name, seq) VALUES ({_literal(row[0])}, {row[1]});")
    conn.close()
    return "\n".join(out + later) + "\n"


def make(revision: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp) / "tree"
        _extract(revision, tree)
        db = Path(tmp) / "speaker_memory.db"
        env = {**os.environ, "PYTHONPATH": str(tree), "SONORUS_DATA_DIR": tmp, "DB_PATH": str(db)}
        subprocess.run([sys.executable, "-c", CHILD, str(db)], cwd=tmp, env=env, check=True)
        _fill(db)
        return f"-- Made by tests/fixtures/db/make_snapshots.py from {revision}.\n" + dump(db)


if __name__ == "__main__":
    for file_name, revision in SNAPSHOTS.items():
        (HERE / file_name).write_text(make(revision), encoding="utf-8")
        print(f"{file_name} ← {revision}")
