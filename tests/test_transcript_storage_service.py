"""
Tests for TranscriptStorageService — save(), load(), update_segments_speaker(),
update_segment_speaker(), list_all(), update_segment_text(), delete_segment(),
and get_embeddings_grouped_by_transcript().
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
# get_embeddings_grouped_by_transcript() — filtering rules
# ---------------------------------------------------------------------------

def _all_embeddings(svc, speaker_id):
    """Flatten get_embeddings_grouped_by_transcript() across transcripts."""
    return [e for embs in svc.get_embeddings_grouped_by_transcript(speaker_id).values() for e in embs]


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

    result = _all_embeddings(svc, "speaker-A")

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

    result = _all_embeddings(svc, "speaker-NOBODY")

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

    result = _all_embeddings(svc, "speaker-A")

    assert len(result) == 2
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


def test_get_embeddings_aggregates_across_transcripts(tmp_path):
    """Speaker A appears in two separate transcriptions — the grouped query
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

    result = _all_embeddings(svc, "speaker-A")

    assert len(result) == 2
    vectors = [e.tolist() for e in result]
    assert emb1.tolist() in vectors
    assert emb2.tolist() in vectors


def test_get_embeddings_grouped_by_transcript_groups_correctly(tmp_path):
    """get_embeddings_grouped_by_transcript returns a dict keyed by transcription id.

    Two transcripts — one with 1 segment, one with 2 segments — must produce
    two separate groups, each containing only its own segments' embeddings.
    """
    svc = make_service(tmp_path)

    emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    emb2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    emb3 = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    seg1 = Segment(0.0, 2.0, "T1", "SPEAKER_00", speaker_resolved="spk-A", embedding=emb1)
    seg1.speaker_final = "spk-A"
    seg2 = Segment(0.0, 2.0, "T2a", "SPEAKER_00", speaker_resolved="spk-A", embedding=emb2)
    seg3 = Segment(2.0, 4.0, "T2b", "SPEAKER_00", speaker_resolved="spk-A", embedding=emb3)
    seg2.speaker_final = "spk-A"
    seg3.speaker_final = "spk-A"

    t1_id = svc.save(make_transcript([seg1], audio_path="files/t1.wav"))
    t2_id = svc.save(make_transcript([seg2, seg3], audio_path="files/t2.wav"))

    grouped = svc.get_embeddings_grouped_by_transcript("spk-A")

    assert set(grouped.keys()) == {t1_id, t2_id}
    assert len(grouped[t1_id]) == 1
    assert np.allclose(grouped[t1_id][0], emb1)
    assert len(grouped[t2_id]) == 2
    t2_vecs = [e.tolist() for e in grouped[t2_id]]
    assert emb2.tolist() in t2_vecs
    assert emb3.tolist() in t2_vecs


def test_get_embeddings_grouped_returns_empty_for_unknown_speaker(tmp_path):
    """Querying a speaker with no segments returns an empty dict."""
    svc = make_service(tmp_path)
    seg = Segment(0.0, 2.0, "Hi", "SPEAKER_00", speaker_resolved="spk-A",
                  embedding=np.array([1.0, 0.0, 0.0], dtype=np.float32))
    seg.speaker_final = "spk-A"
    svc.save(make_transcript([seg]))

    assert svc.get_embeddings_grouped_by_transcript("spk-NOBODY") == {}


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

    result = _all_embeddings(svc, "speaker-A")

    assert len(result) == 1
    assert np.allclose(result[0], emb_a)
    assert not any(np.allclose(e, emb_b) for e in result)


# ---------------------------------------------------------------------------
# Performance: indexes and embedding-free loads
# ---------------------------------------------------------------------------

def _index_columns(db_path):
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='segments'"
        ).fetchall()
        return {
            tuple(c[2] for c in conn.execute(f"PRAGMA index_info('{name}')"))
            for (name,) in rows
        }


def test_segments_indexed_by_transcription_and_speaker(tmp_path):
    svc = make_service(tmp_path)
    cols = _index_columns(svc.db_path)
    assert ("transcription_id",) in cols
    assert ("speaker_id",) in cols


def test_indexes_added_to_existing_v3_database(tmp_path):
    db = str(tmp_path / "old.db")
    TranscriptStorageService(db_path=db)
    with sqlite3.connect(db) as conn:  # simulate a DB created before the indexes existed
        for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='segments' AND sql IS NOT NULL").fetchall():
            conn.execute(f"DROP INDEX {name}")
        conn.execute("UPDATE _ts_schema_version SET version = 3")
    TranscriptStorageService(db_path=db)
    assert ("speaker_id",) in _index_columns(db)


def test_load_without_embeddings_skips_blobs(tmp_path):
    svc = make_service(tmp_path)
    seg = Segment(0.0, 1.0, "x", "SPEAKER_00", speaker_resolved="a", embedding=np.ones(3, dtype=np.float32))
    db_id = svc.save(make_transcript([seg]))
    loaded = svc.load(db_id, with_embeddings=False)
    assert loaded.segments[0].embedding is None
    assert loaded.segments[0].text == "x"
    assert svc.load(db_id).segments[0].embedding is not None



# ---------------------------------------------------------------------------
# clear()
# ---------------------------------------------------------------------------

def test_clear_removes_all_transcripts_and_segments(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript())
    svc.save(make_transcript(audio_path="files/other.wav"))

    assert svc.clear() == 2

    assert svc.list_all() == []
    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        assert conn.execute("SELECT COUNT(*) FROM segments").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM transcriptions").fetchone()[0] == 0


def test_clear_on_empty_db_returns_zero(tmp_path):
    assert make_service(tmp_path).clear() == 0


def test_save_works_after_clear(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript())
    svc.clear()

    db_id = svc.save(make_transcript())

    assert len(svc.load(db_id).segments) == 2
    assert len(svc.list_all()) == 1


def test_count_by_audio_file(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript(audio_path="a.wav"))
    svc.save(make_transcript(audio_path="a.wav"))
    svc.save(make_transcript(audio_path="b.wav"))

    assert svc.count_by_audio_file("a.wav") == 2
    assert svc.count_by_audio_file("b.wav") == 1
    assert svc.count_by_audio_file("c.wav") == 0


# ---------------------------------------------------------------------------
# Unassigned segments (schema v5)
# ---------------------------------------------------------------------------

from app.models.segment import UNASSIGNED


def test_segments_default_to_assigned(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())
    assert [s.unassigned for s in svc.load(db_id).segments] == [False, False]


def test_unassign_speaker_flags_segments_across_transcripts(tmp_path):
    svc = make_service(tmp_path)
    first = svc.save(make_transcript())
    second = svc.save(make_transcript([
        Segment(0.0, 1.0, "A", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(1.0, 2.0, "B", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(2.0, 3.0, "C", "SPEAKER_01", speaker_resolved="Carol"),
    ]))

    assert svc.unassign_speaker("Alice") == {"segments": 3, "transcripts": 2}

    segs = svc.load(second).segments
    assert [s.unassigned for s in segs] == [True, True, False]
    assert [s.speaker_resolved for s in segs] == [None, None, "Carol"]
    assert svc.load(first).segments[1].speaker_resolved == "Bob"


def test_unassign_unknown_speaker_changes_nothing(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())
    assert svc.unassign_speaker("Nobody") == {"segments": 0, "transcripts": 0}
    assert not any(s.unassigned for s in svc.load(db_id).segments)


def test_unassigned_segments_do_not_contribute_embeddings(tmp_path):
    svc = make_service(tmp_path)
    emb = np.ones(3, dtype=np.float32)
    svc.save(make_transcript([Segment(0.0, 1.0, "x", "SPEAKER_00", speaker_resolved="Alice", embedding=emb)]))
    svc.unassign_speaker("Alice")
    assert svc.get_embeddings_grouped_by_transcript("Alice") == {}


def test_save_round_trips_unassigned_flag(tmp_path):
    svc = make_service(tmp_path)
    seg = Segment(0.0, 1.0, "x", "SPEAKER_00", speaker_resolved="Alice", unassigned=True)
    db_id = svc.save(make_transcript([seg]))
    loaded = svc.load(db_id).segments[0]
    assert loaded.unassigned is True
    assert loaded.speaker_resolved is None


def test_single_segment_reassign_clears_unassigned_flag(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript())
    svc.unassign_speaker("Alice")

    svc.update_segment_speaker(db_id, 0.0, 2.0, "Carol")

    seg = svc.load(db_id).segments[0]
    assert seg.unassigned is False
    assert seg.speaker_resolved == "Carol"


def test_bulk_reassign_from_unassigned_moves_only_flagged_segments(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript([
        Segment(0.0, 1.0, "A", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(1.0, 2.0, "B", "SPEAKER_01", speaker_resolved="Bob"),
        Segment(2.0, 3.0, "C", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(3.0, 4.0, "D", "SPEAKER_02"),  # raw fallback, not unassigned
    ]))
    svc.unassign_speaker("Alice")

    svc.update_segments_speaker(db_id, UNASSIGNED, "Carol")

    segs = svc.load(db_id).segments
    assert [s.speaker_resolved for s in segs] == ["Carol", "Bob", "Carol", None]
    assert not any(s.unassigned for s in segs)


def test_unassigned_segments_are_not_listed_as_transcript_speakers(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript())
    svc.unassign_speaker("Alice")
    assert svc.list_all()[0]["speakers"] == ["Bob"]


def test_unassigned_column_added_to_existing_v4_database(tmp_path):
    db = str(tmp_path / "old.db")
    with sqlite3.connect(db) as conn:  # a v4 database: no unassigned column
        conn.execute("CREATE TABLE _ts_schema_version (version INTEGER NOT NULL DEFAULT 0)")
        conn.execute("INSERT INTO _ts_schema_version VALUES (4)")
        conn.execute("CREATE TABLE transcriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, audio_file TEXT NOT NULL,"
                     " language TEXT, status TEXT DEFAULT 'draft', created_at TEXT, title TEXT)")
        conn.execute("CREATE TABLE segments (id INTEGER PRIMARY KEY AUTOINCREMENT, transcription_id INTEGER NOT NULL,"
                     " speaker_id TEXT, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL,"
                     " speaker_raw TEXT, embedding BLOB)")
        conn.execute("INSERT INTO transcriptions (audio_file) VALUES ('a.wav')")
        conn.execute("INSERT INTO segments (transcription_id, speaker_id, start, end, text, speaker_raw)"
                     " VALUES (1, 'Alice', 0, 1, 'x', 'SPEAKER_00')")

    svc = TranscriptStorageService(db_path=db)

    seg = svc.load(1).segments[0]
    assert seg.unassigned is False and seg.speaker_resolved == "Alice"
    from app.db.schema import SCHEMA_VERSION
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0] == SCHEMA_VERSION


# ---------------------------------------------------------------------------
# Speaker statistics
# ---------------------------------------------------------------------------

def test_speaker_stats_aggregates_segments_transcripts_and_time(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript([
        Segment(0.0, 2.0, "A", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(2.0, 3.5, "B", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(3.5, 4.0, "C", "SPEAKER_01", speaker_resolved="Bob"),
    ]))
    svc.save(make_transcript([Segment(0.0, 1.0, "D", "SPEAKER_00", speaker_resolved="Alice")]))

    stats = svc.speaker_stats()

    assert stats["Alice"]["segments"] == 3
    assert stats["Alice"]["transcripts"] == 2
    assert stats["Alice"]["duration_sec"] == pytest.approx(4.5)
    assert stats["Alice"]["last_seen"]
    assert stats["Bob"] == {**stats["Bob"], "segments": 1, "transcripts": 1}


def test_speaker_stats_ignore_unassigned_and_raw_segments(tmp_path):
    svc = make_service(tmp_path)
    svc.save(make_transcript([
        Segment(0.0, 1.0, "A", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(1.0, 2.0, "B", "SPEAKER_01"),
    ]))
    svc.unassign_speaker("Alice")
    assert svc.speaker_stats() == {}


def test_transcripts_for_speaker_lists_each_transcript_once(tmp_path):
    svc = make_service(tmp_path)
    first = svc.save(make_transcript([
        Segment(0.0, 2.0, "A", "SPEAKER_00", speaker_resolved="Alice"),
        Segment(2.0, 3.0, "B", "SPEAKER_00", speaker_resolved="Alice"),
    ], audio_path="files/first.wav"))
    svc.save(make_transcript([Segment(0.0, 1.0, "C", "SPEAKER_00", speaker_resolved="Bob")]))

    rows = svc.transcripts_for_speaker("Alice")

    assert len(rows) == 1
    assert rows[0]["id"] == first
    assert rows[0]["title"] == "first"
    assert rows[0]["segments"] == 2
    assert rows[0]["duration_sec"] == pytest.approx(3.0)
    assert rows[0]["created_at"]


def test_transcripts_for_unknown_speaker_is_empty(tmp_path):
    assert make_service(tmp_path).transcripts_for_speaker("Nobody") == []


def _v5_database(db, rows):
    """A v5 DB whose segments rows are (transcription_id, speaker_id, speaker_raw, unassigned)."""
    TranscriptStorageService(db_path=db)
    with sqlite3.connect(db) as conn:
        conn.execute("INSERT INTO transcriptions (id, audio_file) VALUES (1, 'a.wav'), (2, 'b.wav')")
        for i, (tid, spk, raw, unassigned) in enumerate(rows):
            conn.execute(
                "INSERT INTO segments (transcription_id, speaker_id, start, end, text, speaker_raw, unassigned)"
                " VALUES (?, ?, ?, ?, 'x', ?, ?)", (tid, spk, float(i), float(i) + 1, raw, unassigned))
        conn.execute("UPDATE _ts_schema_version SET version = 5")


def test_v6_migration_gives_raw_labels_a_uuid_per_transcript(tmp_path):
    import uuid
    db = str(tmp_path / "old.db")
    _v5_database(db, [
        (1, None, "SPEAKER_02", 0), (1, None, "SPEAKER_02", 0), (1, None, "SPEAKER_03", 0),
        (2, None, "SPEAKER_02", 0), (1, "Alice", "SPEAKER_00", 0),
    ])

    svc = TranscriptStorageService(db_path=db)

    t1, t2 = svc.load(1).segments, svc.load(2).segments
    a, b, c, alice = (s.speaker_resolved for s in t1)
    assert uuid.UUID(a).version == 4 and a == b and a != c
    assert t2[0].speaker_resolved not in (a, c), "same label in another transcript is another speaker"
    assert alice == "Alice"
    assert not any(s.unassigned for s in t1 + t2)
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0] == 6


def test_v6_migration_unassigns_segments_without_a_diarization_speaker(tmp_path):
    db = str(tmp_path / "old.db")
    _v5_database(db, [(1, None, "UNKNOWN", 0), (1, None, "", 0), (1, None, None, 0), (1, None, "SPEAKER_00", 1)])

    segs = TranscriptStorageService(db_path=db).load(1).segments

    assert all(s.unassigned for s in segs)
    assert all(s.speaker_resolved is None for s in segs)


def test_bulk_reassign_works_for_a_migrated_raw_speaker(tmp_path):
    db = str(tmp_path / "old.db")
    _v5_database(db, [(1, None, "SPEAKER_02", 0), (1, None, "SPEAKER_02", 0)])
    svc = TranscriptStorageService(db_path=db)
    old = svc.load(1).segments[0].speaker_resolved

    svc.update_segments_speaker(1, old, "Carol")

    assert [s.speaker_resolved for s in svc.load(1).segments] == ["Carol", "Carol"]


# ---------------------------------------------------------------------------
# update_title()
# ---------------------------------------------------------------------------

def test_update_title_persists_for_load_and_list_all(tmp_path):
    svc = make_service(tmp_path)
    db_id = svc.save(make_transcript(audio_path="files/team_standup.wav"))

    assert svc.update_title(db_id, "Weekly sync") is True

    assert svc.load(db_id, with_embeddings=False).title == "Weekly sync"
    assert svc.list_all()[0]["title"] == "Weekly sync"


def test_update_title_only_affects_given_transcription(tmp_path):
    svc = make_service(tmp_path)
    a = svc.save(make_transcript(audio_path="files/a.wav"))
    b = svc.save(make_transcript(audio_path="files/b.wav"))

    svc.update_title(a, "Renamed")

    assert svc.load(b, with_embeddings=False).title is None


def test_update_title_missing_id_returns_false(tmp_path):
    svc = make_service(tmp_path)

    assert svc.update_title(999, "Ghost") is False
