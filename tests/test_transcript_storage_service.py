"""
Tests for TranscriptStorageService — save(), load(), update_segments_speaker(),
update_segment_speaker(), list_all(), update_segment_text(), delete_segment(),
and get_embeddings_by_speaker().
"""

import sqlite3
import numpy as np
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_storage_service import TranscriptStorageService


def make_service(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "test.db"))


def make_transcript(segments=None, audio_path="files/meeting.wav", language="en"):
    if segments is None:
        segments = [
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
            Segment(2.0, 4.0, "Bye",   "SPEAKER_01", speaker_resolved="Bob"),
        ]
    return Transcript(audio_path=audio_path, language=language, segments=segments)


# ---------------------------------------------------------------------------
# save()
# ---------------------------------------------------------------------------

def test_save_creates_transcription_row(tmp_path):
    svc = make_service(tmp_path)
    transcript = make_transcript(audio_path="files/output.wav")

    transcription_id = svc.save(transcript)

    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        row = conn.execute(
            "SELECT audio_file, language FROM transcriptions WHERE id = ?",
            (transcription_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == "files/output.wav"
    assert row[1] == "en"


def test_save_creates_segment_rows(tmp_path):
    svc = make_service(tmp_path)
    transcript = make_transcript()

    transcription_id = svc.save(transcript)

    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        rows = conn.execute(
            "SELECT speaker_id, start, end, text, speaker_raw FROM segments WHERE transcription_id = ?",
            (transcription_id,),
        ).fetchall()

    assert len(rows) == 2

    speaker_ids = {r[0] for r in rows}
    assert "Alice" in speaker_ids
    assert "Bob" in speaker_ids

    row0 = next(r for r in rows if r[1] == 0.0)
    assert row0[2] == 2.0
    assert row0[3] == "Hello"
    assert row0[4] == "SPEAKER_00"


def test_speaker_final_takes_priority_over_resolved(tmp_path):
    svc = make_service(tmp_path)

    seg = Segment(0.0, 2.0, "Text", "SPEAKER_00", speaker_resolved="Alice")
    seg.speaker_final = "Carol"
    transcript = make_transcript(segments=[seg])

    transcription_id = svc.save(transcript)

    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        row = conn.execute(
            "SELECT speaker_id FROM segments WHERE transcription_id = ?",
            (transcription_id,),
        ).fetchone()

    assert row[0] == "Carol"


def test_segment_with_no_speaker(tmp_path):
    svc = make_service(tmp_path)

    seg = Segment(0.0, 2.0, "Text", "SPEAKER_00")
    transcript = make_transcript(segments=[seg])

    transcription_id = svc.save(transcript)

    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        row = conn.execute(
            "SELECT speaker_id FROM segments WHERE transcription_id = ?",
            (transcription_id,),
        ).fetchone()

    assert row[0] is None


def test_multiple_saves_are_independent(tmp_path):
    svc = make_service(tmp_path)

    svc.save(make_transcript(audio_path="files/a.wav"))
    svc.save(make_transcript(audio_path="files/b.wav"))

    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        count = conn.execute("SELECT COUNT(*) FROM transcriptions").fetchone()[0]
        seg_count = conn.execute("SELECT COUNT(*) FROM segments").fetchone()[0]

    assert count == 2
    assert seg_count == 4


def test_init_db_is_idempotent(tmp_path):
    db_path = str(tmp_path / "test.db")
    TranscriptStorageService(db_path=db_path)
    TranscriptStorageService(db_path=db_path)


# ---------------------------------------------------------------------------
# load()
# ---------------------------------------------------------------------------

def test_load_returns_transcript_with_correct_fields(tmp_path):
    svc = make_service(tmp_path)
    transcript = make_transcript(audio_path="files/meeting.wav", language="ru")
    db_id = svc.save(transcript)

    loaded = svc.load(db_id)

    assert loaded.audio_path == "files/meeting.wav"
    assert loaded.language == "ru"
    assert loaded.status == "draft"
    assert loaded.db_id == db_id


def test_load_restores_segments(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())

    loaded = svc.load(db_id)

    assert len(loaded.segments) == 2
    assert loaded.segments[0].text == "Hello"
    assert loaded.segments[0].start == 0.0
    assert loaded.segments[0].end == 2.0
    assert loaded.segments[0].speaker_raw == "SPEAKER_00"


def test_load_restores_speaker_resolved(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())

    loaded = svc.load(db_id)

    assert loaded.segments[0].speaker_resolved == "Alice"
    assert loaded.segments[1].speaker_resolved == "Bob"


def test_load_segments_ordered_by_start(tmp_path):
    svc = make_service(tmp_path)
    segments = [
        Segment(5.0, 7.0, "Third",  "SPEAKER_00"),
        Segment(0.0, 2.0, "First",  "SPEAKER_00"),
        Segment(2.0, 4.0, "Second", "SPEAKER_01"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    loaded = svc.load(db_id)

    starts = [s.start for s in loaded.segments]
    assert starts == sorted(starts)


def test_load_raises_on_missing_id(tmp_path):
    svc = make_service(tmp_path)

    with pytest.raises(ValueError):
        svc.load(999)


# ---------------------------------------------------------------------------
# update_segments_speaker()
# ---------------------------------------------------------------------------

def test_update_segments_speaker_reassigns_all_matching(tmp_path):
    svc = make_service(tmp_path)
    segments = [
        Segment(0.0, 2.0, "Hi",    "SPEAKER_00", speaker_resolved="Alice"),
        Segment(2.0, 4.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.update_segments_speaker(db_id, "Alice", "Carol")

    loaded = svc.load(db_id)
    assert all(s.speaker_resolved == "Carol" for s in loaded.segments)


def test_update_segments_speaker_leaves_other_speakers_unchanged(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())

    svc.update_segments_speaker(db_id, "Alice", "Carol")

    loaded = svc.load(db_id)
    speakers = {s.speaker_resolved for s in loaded.segments}
    assert "Bob" in speakers
    assert "Alice" not in speakers
    assert "Carol" in speakers


def test_update_segments_speaker_only_affects_given_transcription(tmp_path):
    svc = make_service(tmp_path)
    db_id_1 = svc.save(make_transcript(audio_path="files/a.wav"))
    db_id_2 = svc.save(make_transcript(audio_path="files/b.wav"))

    svc.update_segments_speaker(db_id_1, "Alice", "Carol")

    loaded_2 = svc.load(db_id_2)
    assert loaded_2.segments[0].speaker_resolved == "Alice"


# ---------------------------------------------------------------------------
# update_segment_speaker()
# ---------------------------------------------------------------------------

def test_update_segment_speaker_changes_one_segment(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())

    svc.update_segment_speaker(db_id, start=0.0, end=2.0, new_speaker="Carol")

    loaded = svc.load(db_id)
    assert loaded.segments[0].speaker_resolved == "Carol"


def test_update_segment_speaker_leaves_other_segments_unchanged(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())

    svc.update_segment_speaker(db_id, start=0.0, end=2.0, new_speaker="Carol")

    loaded = svc.load(db_id)
    assert loaded.segments[1].speaker_resolved == "Bob"


# ---------------------------------------------------------------------------
# list_all()
# ---------------------------------------------------------------------------

def test_list_all_returns_one_record_per_transcription(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript(audio_path="files/a.wav"))
    svc.save(make_transcript(audio_path="files/b.wav"))

    records = svc.list_all()

    assert len(records) == 2


def test_list_all_record_has_expected_keys(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript())

    record = svc.list_all()[0]

    assert {"id", "title", "section", "status", "duration", "speakers"} <= record.keys()


def test_list_all_title_derived_from_filename(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript(audio_path="files/team_standup.wav"))

    record = svc.list_all()[0]

    assert record["title"] == "team_standup"


def test_list_all_today_section(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript())

    record = svc.list_all()[0]

    assert record["section"] == "Today"


def test_list_all_newest_first(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript(audio_path="files/first.wav"))
    svc.save(make_transcript(audio_path="files/second.wav"))

    records = svc.list_all()

    assert records[0]["title"] == "second"
    assert records[1]["title"] == "first"


def test_list_all_speakers_populated(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript())

    record = svc.list_all()[0]

    assert "Alice" in record["speakers"]
    assert "Bob" in record["speakers"]


# ---------------------------------------------------------------------------
# update_segment_text()
# ---------------------------------------------------------------------------

def test_update_segment_text_changes_only_target_row(tmp_path):
    """update_segment_text changes the text of the segment identified by
    start/end and leaves the other two segments unchanged."""
    svc = make_service(tmp_path)
    segments = [
        Segment(0.0, 1.0, "first",  "SPEAKER_00"),
        Segment(1.0, 2.0, "second", "SPEAKER_01"),
        Segment(2.0, 3.0, "third",  "SPEAKER_00"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.update_segment_text(db_id, start=1.0, end=2.0, new_text="new text")

    loaded = svc.load(db_id)
    texts = [s.text for s in loaded.segments]
    assert texts == ["first", "new text", "third"]


def test_update_segment_text_no_match_is_noop(tmp_path):
    """update_segment_text with non-matching start/end leaves all rows
    unchanged and does not raise."""
    svc = make_service(tmp_path)
    segments = [
        Segment(0.0, 1.0, "alpha", "SPEAKER_00"),
        Segment(1.0, 2.0, "beta",  "SPEAKER_01"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.update_segment_text(db_id, start=99.0, end=100.0, new_text="ghost")

    loaded = svc.load(db_id)
    texts = [s.text for s in loaded.segments]
    assert texts == ["alpha", "beta"]


def test_update_segment_text_persists_across_load(tmp_path):
    """After update_segment_text, a fresh load from a new service instance
    returns the updated text — confirming the write was committed to disk."""
    svc = make_service(tmp_path)
    segments = [
        Segment(0.0, 2.0, "original", "SPEAKER_00"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.update_segment_text(db_id, start=0.0, end=2.0, new_text="updated")

    # New instance — no in-memory cache
    svc2 = make_service(tmp_path)
    loaded = svc2.load(db_id)
    assert loaded.segments[0].text == "updated"


# ---------------------------------------------------------------------------
# delete_segment()
# ---------------------------------------------------------------------------

def test_delete_segment_removes_only_target_row(tmp_path):
    """delete_segment removes the segment identified by start/end; the
    remaining two segments are still present in order."""
    svc = make_service(tmp_path)
    segments = [
        Segment(0.0, 1.0, "first",  "SPEAKER_00"),
        Segment(1.0, 2.0, "second", "SPEAKER_01"),
        Segment(2.0, 3.0, "third",  "SPEAKER_00"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.delete_segment(db_id, start=1.0, end=2.0)

    loaded = svc.load(db_id)
    assert len(loaded.segments) == 2
    texts = [s.text for s in loaded.segments]
    assert texts == ["first", "third"]


def test_delete_segment_no_match_is_noop(tmp_path):
    """delete_segment with non-matching start/end leaves all 3 rows intact
    and does not raise."""
    svc = make_service(tmp_path)
    segments = [
        Segment(0.0, 1.0, "x", "SPEAKER_00"),
        Segment(1.0, 2.0, "y", "SPEAKER_01"),
        Segment(2.0, 3.0, "z", "SPEAKER_00"),
    ]
    db_id = svc.save(make_transcript(segments=segments))

    svc.delete_segment(db_id, start=99.0, end=100.0)

    loaded = svc.load(db_id)
    assert len(loaded.segments) == 3


# ---------------------------------------------------------------------------
# get_embeddings_by_speaker()
# ---------------------------------------------------------------------------

def test_get_embeddings_returns_embeddings_for_known_speaker(tmp_path):
    """Save 1 transcript with 2 segments belonging to speaker A — method returns
    exactly those 2 embedding vectors."""
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.8, 0.2, 0.0], dtype=np.float32)

    seg1 = Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb1)
    seg2 = Segment(2.0, 4.0, "World", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb2)
    seg1.speaker_final = "speaker-A"
    seg2.speaker_final = "speaker-A"

    svc.save(make_transcript([seg1, seg2]))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 2
    assert all(isinstance(e, np.ndarray) for e in result)
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


def test_get_embeddings_returns_empty_for_unknown_speaker(tmp_path):
    """When the requested speaker_id has no segments in the DB, an empty list
    is returned — no exception is raised."""
    svc = make_service(tmp_path)

    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="speaker-A",
                  embedding=np.array([1.0, 0.0, 0.0], dtype=np.float32))
    seg.speaker_final = "speaker-A"
    svc.save(make_transcript([seg]))

    result = svc.get_embeddings_by_speaker("speaker-NOBODY")

    assert result == []


def test_get_embeddings_ignores_null_embeddings(tmp_path):
    """3 segments for speaker A, one of which has embedding=None — only the 2
    non-null embeddings are returned."""
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    seg1 = Segment(0.0, 1.0, "one",   "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb1)
    seg2 = Segment(1.0, 2.0, "two",   "SPEAKER_00", speaker_resolved="speaker-A", embedding=None)
    seg3 = Segment(2.0, 3.0, "three", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb2)
    seg1.speaker_final = "speaker-A"
    seg2.speaker_final = "speaker-A"
    seg3.speaker_final = "speaker-A"

    svc.save(make_transcript([seg1, seg2, seg3]))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 2
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


def test_get_embeddings_aggregates_across_transcripts(tmp_path):
    """Speaker A appears in two separate transcriptions — get_embeddings_by_speaker
    returns the embeddings from both transcriptions combined."""
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    seg1 = Segment(0.0, 2.0, "First",  "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb1)
    seg2 = Segment(0.0, 2.0, "Second", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb2)
    seg1.speaker_final = "speaker-A"
    seg2.speaker_final = "speaker-A"

    svc.save(make_transcript([seg1], audio_path="files/session1.wav"))
    svc.save(make_transcript([seg2], audio_path="files/session2.wav"))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 2
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


def test_get_embeddings_does_not_return_other_speakers(tmp_path):
    """Transcript contains segments for both speaker A and speaker B. Querying
    by A's ID must not include any of B's embeddings."""
    svc = make_service(tmp_path)

    emb_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb_b = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    seg_a = Segment(0.0, 2.0, "A speaks", "SPEAKER_00", speaker_resolved="speaker-A", embedding=emb_a)
    seg_b = Segment(2.0, 4.0, "B speaks", "SPEAKER_01", speaker_resolved="speaker-B", embedding=emb_b)
    seg_a.speaker_final = "speaker-A"
    seg_b.speaker_final = "speaker-B"

    svc.save(make_transcript([seg_a, seg_b]))

    result = svc.get_embeddings_by_speaker("speaker-A")

    assert len(result) == 1
    assert np.allclose(result[0], emb_a)
    assert not any(np.allclose(e, emb_b) for e in result)
