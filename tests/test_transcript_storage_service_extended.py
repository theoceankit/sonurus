"""
Tests for TranscriptStorageService — load(), update_segments_speaker(),
update_segment_speaker(), list_all().
"""

import sqlite3
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_storage_service import TranscriptStorageService


def make_service(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "test.db"))


def make_transcript(audio_path="files/meeting.wav", language="en", segments=None):
    if segments is None:
        segments = [
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="Alice"),
            Segment(2.0, 4.0, "Bye",   "SPEAKER_01", speaker_resolved="Bob"),
        ]
    return Transcript(audio_path=audio_path, language=language, segments=segments)


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
# update_segment_text()   [issue #9]
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
