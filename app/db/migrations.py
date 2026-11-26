"""The schema of the database (speaker_memory.db): every table of it, made and
changed by one chain of numbered steps.

The version is PRAGMA user_version: the number of the last step applied. Each
step runs in its own transaction together with the new version, so a database
is always at one version or the next, never in between: a step cut short is
rolled back and runs again at the next start. SQLite rolls back CREATE and
ALTER TABLE as well, so a step needs no checks for work half done.

To change the schema, add a step: a function of the connection under the next
number in STEPS, and raise LATEST to it. Never edit a step that has been
released.

ensure_schema() runs the chain; every service that opens the database calls
it, and the API calls it first of all at start-up (app/api/main.py). It
refuses a database it cannot bring up (SchemaRefused): one of a newer version
of the app, or one older than the oldest release it knows.
"""
import os
import sqlite3
import uuid
from pathlib import Path

from app.db import search_index
from app.logger import get_logger

log = get_logger("DB")

LATEST = 1

# Made once, before a database of an earlier release is first brought up to
# the chain; never overwritten.
BACKUP_SUFFIX = ".before-migration"

# The two version counters of the releases before the chain (0.2.0 to 0.3.2):
# _ts_schema_version for the transcript tables, _meta.schema_version for the
# speaker tables. Step 1 takes these ranges; anything older is refused.
_TRANSCRIPTS_FROM, _TRANSCRIPTS_TO = 6, 12
_SPEAKERS_FROM, _SPEAKERS_TO = 3, 5


class SchemaRefused(Exception):
    """The database cannot be used by this version: kind is "newer" (made by a
    newer version of the app) or "unsupported" (older than any release this
    version can bring up, or with versions that do not fit together)."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def ensure_schema(db_path: str) -> None:
    """Bring the database at db_path to LATEST, creating it if it is new.
    Raises SchemaRefused, leaving the file untouched."""
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    try:
        version = _version(conn)
        if version == LATEST:
            return
        _refuse_newer(version)
        if version == 0:
            # Read only: a database refused here is left as it was.
            if _legacy_versions(conn) is not None:
                _make_backup(conn, db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        while True:
            # IMMEDIATE: another process opening the database (the API and a
            # job's process) waits here and finds the step done.
            conn.execute("BEGIN IMMEDIATE")
            try:
                version = _version(conn)
                _refuse_newer(version)
                if version == LATEST:
                    conn.execute("COMMIT")
                    return
                STEPS[version + 1](conn)
                conn.execute(f"PRAGMA user_version = {version + 1}")
                conn.execute("COMMIT")
            except BaseException:
                # SQLite may have rolled back already (a full disk, say).
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            log.info(f"Database schema is now at version {version + 1}")
    finally:
        conn.close()


def _version(conn) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def _refuse_newer(version: int) -> None:
    if version > LATEST:
        raise SchemaRefused("newer", f"The database is at schema version {version}; "
                                     f"this version of the app knows up to {LATEST}.")


def _tables(conn) -> set[str]:
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}


def _columns(conn, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _legacy_versions(conn) -> tuple[int, int] | None:
    """(transcript version, speaker version) of a database of a release before
    the chain, None for an empty one. Raises SchemaRefused for anything else."""
    tables = _tables(conn)
    if not tables:
        return None
    transcripts = speakers = None
    if "_ts_schema_version" in tables:
        rows = conn.execute("SELECT version FROM _ts_schema_version").fetchall()
        transcripts = rows[0][0] if len(rows) == 1 else None
    if "_meta" in tables:
        row = conn.execute("SELECT value FROM _meta WHERE key = 'schema_version'").fetchone()
        speakers = int(row[0]) if row and str(row[0]).isdigit() else None
    if (transcripts is None or speakers is None
            or not _TRANSCRIPTS_FROM <= transcripts <= _TRANSCRIPTS_TO
            or not _SPEAKERS_FROM <= speakers <= _SPEAKERS_TO):
        raise SchemaRefused("unsupported", (
            f"The database has transcript schema {transcripts} and speaker schema {speakers}; "
            f"this version of the app brings up {_TRANSCRIPTS_FROM}–{_TRANSCRIPTS_TO} and "
            f"{_SPEAKERS_FROM}–{_SPEAKERS_TO} (Sonorus 0.2.0 or later)."))
    return transcripts, speakers


def _make_backup(conn, db_path: str) -> None:
    target = Path(str(db_path) + BACKUP_SUFFIX)
    if target.exists():
        return
    partial = target.with_name(f"{target.name}.{uuid.uuid4().hex}.partial")
    try:
        _copy_database(conn, partial)
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)
    log.info(f"Copied the database to {target} before bringing it up to the migration chain")


def _copy_database(conn, target: Path) -> None:
    # The backup API copies a consistent database, write-ahead log included.
    dest = sqlite3.connect(target)
    try:
        conn.backup(dest)
    finally:
        dest.close()


# ── Step 1: the schema of 0.3.2 and what followed it, under one version ─────

def _step_1(conn) -> None:
    legacy = _legacy_versions(conn)
    if legacy is None:
        _create_schema(conn)
    else:
        _bring_up_legacy(conn, *legacy)
        _drop_old_counters(conn)


def _create_schema(conn) -> None:
    """The whole schema of a new database. Columns in the order a database of
    an earlier release ends up with, so that the two are the same.

    No "--" comments inside the SQL: SQLite keeps that text and rewrites it on
    ALTER TABLE, and SQLite 3.45 breaks a commented definition on DROP COLUMN."""
    # opened: not opened in the app yet. diarized: whether speakers were looked
    # for, since all-unassigned segments alone do not tell a recording without
    # diarization from one whose speakers were deleted.
    conn.execute("""
        CREATE TABLE transcriptions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            audio_file TEXT NOT NULL,
            language   TEXT,
            status     TEXT DEFAULT 'draft',
            created_at TEXT,
            title      TEXT,
            opened     INTEGER NOT NULL DEFAULT 0,
            diarized   INTEGER NOT NULL DEFAULT 1
        )
    """)
    # unassigned: no speaker, shown as Unassigned rather than falling back to
    # speaker_raw.
    conn.execute("""
        CREATE TABLE segments (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            transcription_id INTEGER NOT NULL REFERENCES transcriptions(id),
            speaker_id       TEXT,
            start            REAL NOT NULL,
            end              REAL NOT NULL,
            text             TEXT NOT NULL,
            speaker_raw      TEXT,
            embedding        BLOB,
            unassigned       INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("CREATE INDEX idx_segments_transcription ON segments(transcription_id)")
    conn.execute("CREATE INDEX idx_segments_speaker ON segments(speaker_id)")
    _create_speaker_matches(conn)
    # The note of a recording: the editor's document as JSON, apart from the
    # segments. A note has its own id and transcription_id may be NULL, so a
    # note can exist before its transcript does and be attached to it later.
    # version: given by every write, for writers to refuse a stale one.
    conn.execute("""
        CREATE TABLE notes (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            transcription_id INTEGER UNIQUE,
            content          TEXT NOT NULL,
            format           INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL,
            version          INTEGER NOT NULL DEFAULT 0,
            writer           TEXT
        )
    """)
    # The counter of note versions: one for all notes and apart from them, so
    # a note deleted and written again never gets a version seen before.
    conn.execute("CREATE TABLE note_version_seq (last INTEGER NOT NULL)")
    conn.execute("INSERT INTO note_version_seq VALUES (0)")
    search_index.create(conn)

    conn.execute("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("""
        CREATE TABLE speaker_embeddings (
            id        TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            count     INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("""
        CREATE TABLE speaker_names (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker_id TEXT NOT NULL,
            label      TEXT NOT NULL,
            name       TEXT NOT NULL
        )
    """)
    # photo: the file name of the speaker's photo in the photos dir.
    conn.execute("""
        CREATE TABLE speaker_meta (
            speaker_id    TEXT PRIMARY KEY,
            color_index   INTEGER NOT NULL DEFAULT 0,
            handle        TEXT,
            handle_manual INTEGER NOT NULL DEFAULT 0,
            photo         TEXT
        )
    """)
    _create_handle_index(conn)

    _create_queue(conn)
    _create_app_settings(conn)


def _create_queue(conn) -> None:
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
            created_at     TEXT NOT NULL,
            diarize        INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("CREATE TABLE IF NOT EXISTS transcription_queue_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


def _create_speaker_matches(conn) -> None:
    # The similarity at which a speaker was recognized in a transcript, and
    # whether the user confirmed them there.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS speaker_matches (
            transcription_id INTEGER NOT NULL,
            speaker_id       TEXT NOT NULL,
            score            REAL NOT NULL,
            confirmed        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (transcription_id, speaker_id)
        )
    """)


def _create_notes_v9(conn) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            transcription_id INTEGER UNIQUE,
            content          TEXT NOT NULL,
            format           INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL
        )
    """)


def _create_handle_index(conn) -> None:
    # Handles are unique whatever the case, kept by the database itself since
    # the API and a pipeline job each hold their own SpeakerMemoryService.
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS speaker_meta_handle ON speaker_meta (handle COLLATE NOCASE)")


def _create_app_settings(conn) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


def _bring_up_legacy(conn, transcripts: int, speakers: int) -> None:
    """The steps the releases before the chain had not taken yet, as they
    were. They keep their checks for a column already there: the old code ran
    them outside a transaction, so a database may hold half of one."""
    if transcripts < 7:
        if "opened" not in _columns(conn, "transcriptions"):
            conn.execute("ALTER TABLE transcriptions ADD COLUMN opened INTEGER NOT NULL DEFAULT 0")
        # Every transcript there when the flag arrived counts as opened.
        conn.execute("UPDATE transcriptions SET opened = 1")
    if transcripts < 8:
        _create_speaker_matches(conn)
    if transcripts < 9:
        _create_notes_v9(conn)
    if transcripts < 10:
        if "diarized" not in _columns(conn, "transcriptions"):
            conn.execute("ALTER TABLE transcriptions ADD COLUMN diarized INTEGER NOT NULL DEFAULT 1")
    if transcripts < 11:
        search_index.create(conn)
        search_index.rebuild(conn)
    if transcripts < 12:
        note_cols = _columns(conn, "notes")
        if "version" not in note_cols:
            conn.execute("ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 0")
        if "writer" not in note_cols:
            conn.execute("ALTER TABLE notes ADD COLUMN writer TEXT")
        conn.execute("CREATE TABLE IF NOT EXISTS note_version_seq (last INTEGER NOT NULL)")
        # A version per note write, from one counter for all notes.
        ids = [r[0] for r in conn.execute("SELECT id FROM notes ORDER BY id").fetchall()]
        conn.executemany("UPDATE notes SET version = ? WHERE id = ?", [(n, i) for n, i in enumerate(ids, 1)])
        conn.execute("DELETE FROM note_version_seq")
        conn.execute("INSERT INTO note_version_seq VALUES (?)", (len(ids),))

    if speakers < 4:
        meta_cols = _columns(conn, "speaker_meta")
        if "handle" not in meta_cols:
            conn.execute("ALTER TABLE speaker_meta ADD COLUMN handle TEXT")
        if "handle_manual" not in meta_cols:
            conn.execute("ALTER TABLE speaker_meta ADD COLUMN handle_manual INTEGER NOT NULL DEFAULT 0")
        _create_handle_index(conn)
    if speakers < 5:
        if "photo" not in _columns(conn, "speaker_meta"):
            conn.execute("ALTER TABLE speaker_meta ADD COLUMN photo TEXT")

    # The queue's tables had no version: a queue from before the choice of
    # diarization finds speakers, as it would have.
    _create_queue(conn)
    if "diarize" not in _columns(conn, "transcription_jobs"):
        conn.execute("ALTER TABLE transcription_jobs ADD COLUMN diarize INTEGER NOT NULL DEFAULT 1")
    _create_app_settings(conn)


def _drop_old_counters(conn) -> None:
    conn.execute("DROP TABLE _ts_schema_version")
    conn.execute("DELETE FROM _meta WHERE key IN ('schema_version', 'm001_uuid_speakers')")


STEPS = {
    1: _step_1,
}
