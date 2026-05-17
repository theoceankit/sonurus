import sqlite3
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_storage_service import TranscriptStorageService


def make_service(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "test.db"))


def make_transcript(**kwargs):
    defaults = dict(
        audio_path="files/output.wav",
        language="en",
        status="draft",
        segments=[
            Segment(0.0, 2.0, "Hello", "SPEAKER_00", speaker_resolved="person_1"),
            Segment(2.0, 4.0, "Bye",   "SPEAKER_01", speaker_resolved="person_2"),
        ],
    )
    defaults.update(kwargs)
    return Transcript(**defaults)


def test_save_creates_transcription_row(tmp_path):
    svc = make_service(tmp_path)
    transcript = make_transcript()

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
    assert "person_1" in speaker_ids
    assert "person_2" in speaker_ids

    row0 = next(r for r in rows if r[1] == 0.0)
    assert row0[2] == 2.0
    assert row0[3] == "Hello"
    assert row0[4] == "SPEAKER_00"


def test_speaker_final_takes_priority_over_resolved(tmp_path):
    svc = make_service(tmp_path)

    seg = Segment(0.0, 2.0, "Text", "SPEAKER_00", speaker_resolved="person_1")
    seg.speaker_final = "person_2"
    transcript = make_transcript(segments=[seg])

    transcription_id = svc.save(transcript)

    with sqlite3.connect(str(tmp_path / "test.db")) as conn:
        row = conn.execute(
            "SELECT speaker_id FROM segments WHERE transcription_id = ?",
            (transcription_id,),
        ).fetchone()

    assert row[0] == "person_2"


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
