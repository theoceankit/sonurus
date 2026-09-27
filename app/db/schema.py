"""Transcript DB schema management: creation and versioned migrations."""
import uuid

SCHEMA_VERSION = 6


def init_db(conn) -> None:
    """Bootstrap and migrate the transcript schema on an open connection."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _ts_schema_version (version INTEGER NOT NULL DEFAULT 0)"
    )
    if conn.execute("SELECT COUNT(*) FROM _ts_schema_version").fetchone()[0] == 0:
        conn.execute(
            "INSERT INTO _ts_schema_version VALUES (?)",
            (_detect_legacy_version(conn),),
        )
    current = conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0]
    _run_migrations(conn, current)


def _detect_legacy_version(conn) -> int:
    """Infer schema version from column presence for DBs that predate version tracking."""
    tables = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "segments" not in tables:
        return 0
    seg_cols = {r[1] for r in conn.execute("PRAGMA table_info(segments)").fetchall()}
    if "embedding" in seg_cols:
        return 2
    txn_cols = {r[1] for r in conn.execute("PRAGMA table_info(transcriptions)").fetchall()}
    return 1 if "status" in txn_cols else 0


def _run_migrations(conn, current: int) -> None:
    if current < 1:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transcriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                audio_file TEXT NOT NULL,
                language   TEXT,
                status     TEXT DEFAULT 'draft',
                created_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS segments (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                transcription_id INTEGER NOT NULL REFERENCES transcriptions(id),
                speaker_id       TEXT,
                start            REAL NOT NULL,
                end              REAL NOT NULL,
                text             TEXT NOT NULL,
                speaker_raw      TEXT
            )
        """)
        txn_cols = {r[1] for r in conn.execute("PRAGMA table_info(transcriptions)").fetchall()}
        if "status" not in txn_cols:
            conn.execute("ALTER TABLE transcriptions ADD COLUMN status TEXT DEFAULT 'draft'")
        conn.execute("UPDATE _ts_schema_version SET version = 1")
        current = 1
    if current < 2:
        seg_cols = {r[1] for r in conn.execute("PRAGMA table_info(segments)").fetchall()}
        if "embedding" not in seg_cols:
            conn.execute("ALTER TABLE segments ADD COLUMN embedding BLOB")
        conn.execute("UPDATE _ts_schema_version SET version = 2")
        current = 2
    if current < 3:
        txn_cols = {r[1] for r in conn.execute("PRAGMA table_info(transcriptions)").fetchall()}
        if "title" not in txn_cols:
            conn.execute("ALTER TABLE transcriptions ADD COLUMN title TEXT")
        conn.execute("UPDATE _ts_schema_version SET version = 3")
        current = 3
    if current < 4:
        # Every transcript load filters by transcription_id and every speaker
        # embedding recompute by speaker_id — both were full table scans.
        conn.execute("CREATE INDEX IF NOT EXISTS idx_segments_transcription ON segments(transcription_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_segments_speaker ON segments(speaker_id)")
        conn.execute("UPDATE _ts_schema_version SET version = 4")
        current = 4
    if current < 5:
        # Segments of a deleted speaker: speaker_id is NULL and the segment is
        # shown as "Unassigned" instead of falling back to speaker_raw.
        seg_cols = {r[1] for r in conn.execute("PRAGMA table_info(segments)").fetchall()}
        if "unassigned" not in seg_cols:
            conn.execute("ALTER TABLE segments ADD COLUMN unassigned INTEGER NOT NULL DEFAULT 0")
        conn.execute("UPDATE _ts_schema_version SET version = 5")
        current = 5
    if current < 6:
        _assign_raw_speakers(conn)
        conn.execute("UPDATE _ts_schema_version SET version = 6")


def _assign_raw_speakers(conn) -> None:
    """Segments stored without a speaker id fell back to the raw diarization
    label. Give each (transcript, SPEAKER_XX) its own new UUID; segments with
    no diarization speaker at all become unassigned."""
    pairs = conn.execute(
        "SELECT DISTINCT transcription_id, speaker_raw FROM segments "
        "WHERE speaker_id IS NULL AND unassigned = 0 AND speaker_raw LIKE 'SPEAKER\\_%' ESCAPE '\\'"
    ).fetchall()
    conn.executemany(
        "UPDATE segments SET speaker_id = ? "
        "WHERE transcription_id = ? AND speaker_raw = ? AND speaker_id IS NULL AND unassigned = 0",
        [(str(uuid.uuid4()), tid, raw) for tid, raw in pairs],
    )
    conn.execute("UPDATE segments SET unassigned = 1 WHERE speaker_id IS NULL AND unassigned = 0")
