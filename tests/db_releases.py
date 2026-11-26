"""Databases of the releases before the single migration chain, for tests of
what bringing one up does to its data.

as_release() takes a database made by this version and puts back the version
counters a release had; a test drops first what that release did not have
yet. tests/fixtures/db/ holds the real thing, made by each release's own code.
"""
import sqlite3


def as_release(db_path, transcripts: int = 12, speakers: int = 5) -> None:
    """Make the database at db_path look like one at transcript schema
    `transcripts` and speaker schema `speakers`, before the chain."""
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA user_version = 0")
        conn.execute("CREATE TABLE _ts_schema_version (version INTEGER NOT NULL DEFAULT 0)")
        conn.execute("INSERT INTO _ts_schema_version VALUES (?)", (transcripts,))
        conn.execute("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)", (str(speakers),))
        conn.execute("INSERT OR REPLACE INTO _meta (key, value) VALUES ('m001_uuid_speakers', 'done')")


def user_version(db_path) -> int:
    with sqlite3.connect(db_path) as conn:
        return conn.execute("PRAGMA user_version").fetchone()[0]
