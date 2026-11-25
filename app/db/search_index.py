"""The full-text search index of transcripts: SQLite FTS5 tables kept next to
the data they index.

- search_segments: rowid = segments.id; kept by triggers on segments.
- search_titles:   rowid = transcriptions.id; the title shown (the file name
                   without one); kept by TranscriptStorageService.
- search_notes:    one row per text block of a note; kept by
                   TranscriptStorageService.

The indexed column holds the text with Ё written as Е, so that one finds the
other; `shown` holds the text as it is. The two have the same length, so
positions found in one hold in the other.
"""

import json
import os
import sqlite3
import time

from app.logger import get_logger
from app.services.note_text import note_blocks

log = get_logger("DB")

_YO = str.maketrans("ёЁ", "еЕ")


def normalize(text: str) -> str:
    """Text as the index holds it: Ё as Е. Keeps the length."""
    return text.translate(_YO)


def _sql_normalize(column: str) -> str:
    return f"replace(replace({column}, 'ё', 'е'), 'Ё', 'Е')"


def create(conn) -> None:
    """Create the index tables and the triggers on segments (idempotent)."""
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS search_segments USING fts5(text, tokenize='unicode61')")
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_titles USING fts5(text, shown UNINDEXED, tokenize='unicode61')"
    )
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_notes USING fts5("
        "text, shown UNINDEXED, transcription_id UNINDEXED, block UNINDEXED, tokenize='unicode61')"
    )
    conn.execute(f"""
        CREATE TRIGGER IF NOT EXISTS search_segments_insert AFTER INSERT ON segments BEGIN
            INSERT INTO search_segments (rowid, text) VALUES (new.id, {_sql_normalize('new.text')});
        END""")
    conn.execute(f"""
        CREATE TRIGGER IF NOT EXISTS search_segments_update AFTER UPDATE OF text ON segments BEGIN
            DELETE FROM search_segments WHERE rowid = old.id;
            INSERT INTO search_segments (rowid, text) VALUES (new.id, {_sql_normalize('new.text')});
        END""")
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS search_segments_delete AFTER DELETE ON segments BEGIN
            DELETE FROM search_segments WHERE rowid = old.id;
        END""")


def rebuild(conn) -> None:
    """Fill the index from the data, replacing whatever it held."""
    started = time.perf_counter()
    conn.execute("DELETE FROM search_segments")
    conn.execute(f"INSERT INTO search_segments (rowid, text) SELECT id, {_sql_normalize('text')} FROM segments")
    conn.execute("DELETE FROM search_titles")
    for tid, title, audio_file in conn.execute("SELECT id, title, audio_file FROM transcriptions").fetchall():
        index_title(conn, tid, title, audio_file)
    conn.execute("DELETE FROM search_notes")
    names = speaker_names(conn)
    for tid, content in conn.execute(
        "SELECT transcription_id, content FROM notes WHERE transcription_id IS NOT NULL"
    ).fetchall():
        index_note(conn, tid, content, names)
    log.info(f"Search index built in {time.perf_counter() - started:.1f} s")


def shown_title(title: str | None, audio_file: str) -> str:
    """The title a recording shows: its own, or the audio file's name without the extension."""
    return title or os.path.splitext(os.path.basename(audio_file))[0]


def index_title(conn, tid: int, title: str | None, audio_file: str) -> None:
    shown = shown_title(title, audio_file)
    conn.execute("DELETE FROM search_titles WHERE rowid = ?", (tid,))
    conn.execute("INSERT INTO search_titles (rowid, text, shown) VALUES (?, ?, ?)", (tid, normalize(shown), shown))


def index_note(conn, tid: int, content: str | dict | None, names: dict[str, str] | None = None) -> None:
    """Replace the blocks of a transcript's note; None removes them."""
    conn.execute("DELETE FROM search_notes WHERE transcription_id = ?", (tid,))
    if content is None:
        return
    doc = json.loads(content) if isinstance(content, str) else content
    if names is None:
        names = speaker_names(conn)
    conn.executemany(
        "INSERT INTO search_notes (text, shown, transcription_id, block) VALUES (?, ?, ?, ?)",
        [(normalize(text), text, tid, i) for i, text in enumerate(note_blocks(doc, names.get))],
    )


def speaker_names(conn) -> dict[str, str]:
    """{speaker id: display name} as stored by SpeakerMemoryService in the same
    database; empty when it keeps its names elsewhere."""
    try:
        rows = conn.execute("SELECT speaker_id, name FROM speaker_names WHERE label = 'display'").fetchall()
    except sqlite3.OperationalError:
        return {}
    return dict(rows)


def clear(conn) -> None:
    for table in ("search_segments", "search_titles", "search_notes"):
        conn.execute(f"DELETE FROM {table}")
