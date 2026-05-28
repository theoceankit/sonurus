"""Transcript DB schema management: creation and versioned migrations."""

SCHEMA_VERSION = 3


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
