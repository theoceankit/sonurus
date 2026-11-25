"""The full-text search index follows the data through every write: segments,
titles and notes are found right after they change and never after they go."""

import json
import sqlite3

import pytest

from app.models.segment import Segment, UNASSIGNED
from app.models.transcript import Transcript
from app.services.commit_service import CommitService
from app.services.search_query import parse_query
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

ANNA = "4f9c0c1e-2a1b-4c7e-9f00-6d1a2b3c4d5e"


def _transcript(title=None, audio="files/планёрка.wav", texts=("Обсудили бюджет", "Ёлку поставим")):
    return Transcript(audio_path=audio, language="ru", title=title, segments=[
        Segment(float(i * 5), float(i * 5 + 4), text, "SPEAKER_00", speaker_resolved=ANNA)
        for i, text in enumerate(texts)
    ])


def _note(*paragraphs):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": inline if isinstance(inline, list) else [{"type": "text", "text": inline}]}
        for inline in paragraphs
    ]}


def _found(db_path, query) -> set[tuple[str, int]]:
    """(kind, transcript id) of every index row the query matches."""
    match = parse_query(query).match
    conn = sqlite3.connect(db_path)
    try:
        rows = [("segment", tid) for (tid,) in conn.execute(
            "SELECT s.transcription_id FROM search_segments f JOIN segments s ON s.id = f.rowid "
            "WHERE search_segments MATCH ?", (match,))]
        rows += [("title", tid) for (tid,) in conn.execute(
            "SELECT rowid FROM search_titles WHERE search_titles MATCH ?", (match,))]
        rows += [("note", tid) for (tid,) in conn.execute(
            "SELECT transcription_id FROM search_notes WHERE search_notes MATCH ?", (match,))]
    finally:
        conn.close()
    return set(rows)


@pytest.fixture
def db(tmp_path):
    return str(tmp_path / "t.db")


@pytest.fixture
def storage(db):
    return TranscriptStorageService(db_path=db)


# ── Segments ──────────────────────────────────────────────────────────────────

def test_saved_segments_are_found_and_yo_is_ye(storage, db):
    tid = storage.save(_transcript())
    assert _found(db, "бюджет") == {("segment", tid)}
    assert _found(db, "елку") == {("segment", tid)}


def test_an_edited_segment_is_found_by_its_new_text_only(storage, db):
    tid = storage.save(_transcript())
    storage.update_segment_text(tid, 0.0, 4.0, "Обсудили смету")
    assert _found(db, "бюджет") == set()
    assert _found(db, "смету") == {("segment", tid)}


def test_a_deleted_segment_is_not_found(storage, db):
    tid = storage.save(_transcript())
    storage.delete_segment(tid, 0.0, 4.0)
    assert _found(db, "бюджет") == set()
    assert _found(db, "елку") == {("segment", tid)}


def test_a_segment_given_another_speaker_is_still_found(storage, db):
    tid = storage.save(_transcript())
    storage.set_segments_speaker(tid, [(0.0, 4.0)], UNASSIGNED)
    assert _found(db, "бюджет") == {("segment", tid)}


# ── Titles ────────────────────────────────────────────────────────────────────

def test_a_title_is_found_and_without_one_the_file_name(storage, db):
    named = storage.save(_transcript(title="Бюджет на ноябрь"))
    unnamed = storage.save(_transcript(audio="files/Планёрка отдела.m4a", texts=("x",)))
    assert ("title", named) in _found(db, "ноябрь")
    assert _found(db, "планерка") == {("title", unnamed)}
    assert _found(db, "m4a") == set(), "the extension is not part of the title"


def test_a_renamed_recording_is_found_by_its_new_title_only(storage, db):
    tid = storage.save(_transcript(title="Старое название"))
    storage.update_title(tid, "Новое название")
    assert _found(db, "старое") == set()
    assert _found(db, "новое") == {("title", tid)}


# ── Notes ─────────────────────────────────────────────────────────────────────

def test_a_saved_note_is_found_by_any_paragraph(storage, db):
    tid = storage.save(_transcript())
    storage.save_note(tid, _note("План на квартал", "Позвонить в банк"))
    assert _found(db, "квартал") == {("note", tid)}
    assert _found(db, "банк") == {("note", tid)}
    assert _found(db, "квартал банк") == set(), "a match lies within one paragraph"


def test_a_note_saved_again_is_found_by_its_new_text_only(storage, db):
    tid = storage.save(_transcript())
    storage.save_note(tid, _note("План на квартал"))
    storage.save_note(tid, _note("План на год"))
    assert _found(db, "квартал") == set()
    assert _found(db, "год") == {("note", tid)}


def test_a_deleted_note_is_not_found(storage, db):
    tid = storage.save(_transcript())
    storage.save_note(tid, _note("План на квартал"))
    storage.delete_note(tid)
    assert _found(db, "квартал") == set()


def test_a_mention_is_found_by_the_speakers_name(db):
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    memory.set_name(ANNA, "Анна")
    memory.save_names_only()
    tid = storage.save(_transcript())
    storage.save_note(tid, _note([
        {"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "Old label"}},
        {"type": "text", "text": " позвонит"},
    ]))
    assert _found(db, "анна позвонит") == {("note", tid)}
    assert _found(db, "label") == set()


def test_a_renamed_speaker_is_found_by_the_new_name_in_notes(db):
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    memory.set_name(ANNA, "Анна")
    memory.save_names_only()
    tid = storage.save(_transcript())
    storage.save_note(tid, _note([{"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "Анна"}}]))
    memory.set_name(ANNA, "Мария")
    memory.save_names_only()
    storage.reindex_notes_mentioning(ANNA)
    assert _found(db, "мария") == {("note", tid)}
    assert _found(db, "анна") == set()


def test_mentions_rewritten_after_a_merge_follow_the_speaker_kept(db):
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    other = "9a1b2c3d-0000-4000-8000-000000000001"
    memory.set_name(ANNA, "Анна")
    memory.set_name(other, "Ольга")
    memory.save_names_only()
    tid = storage.save(_transcript())
    storage.save_note(tid, _note([{"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "Анна"}}]))
    CommitService(memory, storage).merge_speaker(ANNA, other)
    assert _found(db, "ольга") == {("note", tid)}
    assert _found(db, "анна") == set()


def test_a_merged_speaker_without_a_name_takes_the_name_in_notes_too(db):
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    unnamed = "9a1b2c3d-0000-4000-8000-000000000002"
    memory.set_name(ANNA, "Анна")
    memory.save_names_only()
    tid = storage.save(_transcript())
    storage.save_note(tid, _note([{"type": "mention", "attrs": {"kind": "speaker", "id": unnamed, "label": "Speaker 2"}}]))
    CommitService(memory, storage).merge_speaker(ANNA, unnamed)
    assert _found(db, "анна") == {("note", tid)}


def test_a_deleted_speaker_stays_findable_in_notes_by_the_name_it_had(db):
    memory = SpeakerMemoryService(db_path=db)
    storage = TranscriptStorageService(db_path=db)
    memory.set_name(ANNA, "Анна")
    memory.save_names_only()
    tid = storage.save(_transcript())
    storage.save_note(tid, _note([{"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "x"}}]))
    CommitService(memory, storage).delete_speaker(ANNA)
    assert _found(db, "анна") == {("note", tid)}


# ── Recordings ────────────────────────────────────────────────────────────────

def test_a_deleted_recording_leaves_nothing_in_the_index(storage, db):
    tid = storage.save(_transcript(title="Бюджет"))
    keep = storage.save(_transcript(title="Другое", texts=("Бюджет тоже",)))
    storage.save_note(tid, _note("бюджет в заметке"))
    storage.delete(tid)
    assert _found(db, "бюджет") == {("segment", keep)}


def test_clearing_all_data_empties_the_index(storage, db):
    tid = storage.save(_transcript(title="Бюджет"))
    storage.save_note(tid, _note("бюджет"))
    storage.clear()
    assert _found(db, "бюджет") == set()
    conn = sqlite3.connect(db)
    counts = [conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("search_segments", "search_titles", "search_notes")]
    conn.close()
    assert counts == [0, 0, 0]


# ── Migration ─────────────────────────────────────────────────────────────────

def test_a_database_from_before_search_is_indexed_on_start(db):
    """A v10 database with recordings, titles, notes and names: opening it
    builds the index, nothing to do by hand."""
    memory = SpeakerMemoryService(db_path=db)
    memory.set_name(ANNA, "Анна")
    memory.save_names_only()
    storage = TranscriptStorageService(db_path=db)
    tid = storage.save(_transcript(title="Бюджет на ноябрь"))
    untitled = storage.save(_transcript(audio="files/Встреча.wav", texts=("смета",)))
    storage.save_note(tid, _note([
        {"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "x"}},
        {"type": "text", "text": " ёлка"},
    ]))

    conn = sqlite3.connect(db)
    for table in ("search_segments", "search_titles", "search_notes"):
        conn.execute(f"DROP TABLE {table}")
    for (trigger,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'").fetchall():
        conn.execute(f"DROP TRIGGER {trigger}")
    conn.execute("UPDATE _ts_schema_version SET version = 10")
    conn.commit()
    conn.close()

    TranscriptStorageService(db_path=db)
    assert _found(db, "бюджет") == {("segment", tid), ("title", tid)}
    assert _found(db, "встреча") == {("title", untitled)}
    assert _found(db, "смета") == {("segment", untitled)}
    assert _found(db, "анна елка") == {("note", tid)}

    # and it keeps following the data afterwards
    storage = TranscriptStorageService(db_path=db)
    storage.update_segment_text(untitled, 0.0, 4.0, "отпуск")
    assert _found(db, "смета") == set()
    assert _found(db, "отпуск") == {("segment", untitled)}


def test_the_search_index_came_with_schema_11(db):
    TranscriptStorageService(db_path=db)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0] >= 11
    conn.close()


def test_a_migration_run_again_after_a_crash_indexes_everything_once(db):
    """A crash after the index was filled but before the version was written:
    the next start fills it again, with no row twice, and an empty note is fine."""
    storage = TranscriptStorageService(db_path=db)
    tid = storage.save(_transcript(title="Бюджет"))
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO notes (transcription_id, content, created_at, updated_at) VALUES (?, ?, '', '')",
        (tid, json.dumps({"type": "doc"})),
    )
    conn.execute("UPDATE _ts_schema_version SET version = 10")
    conn.commit()
    conn.close()
    TranscriptStorageService(db_path=db)
    conn = sqlite3.connect(db)
    counts = [conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("search_segments", "search_titles", "search_notes")]
    conn.close()
    assert counts == [2, 1, 0]
