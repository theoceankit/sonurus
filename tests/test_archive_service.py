"""
Tests for ArchiveService.archive() and format_time().
"""

import os
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.archive_service import ArchiveService, format_time


def make_service(tmp_path):
    svc = ArchiveService()
    svc.BASE_DIR = str(tmp_path / ".files")
    return svc


def make_audio(tmp_path, name="meeting.wav") -> str:
    path = tmp_path / name
    path.write_bytes(b"fake audio data")
    return str(path)


def make_transcript(audio_path, segments=None):
    if segments is None:
        segments = [
            Segment(0.0,  30.0, "Hello everyone", "SPEAKER_00", speaker_resolved="Alice"),
            Segment(30.0, 60.0, "Thanks for joining", "SPEAKER_01", speaker_resolved="Bob"),
        ]
    return Transcript(audio_path=audio_path, language="en", segments=segments)


# ---------------------------------------------------------------------------
# archive()
# ---------------------------------------------------------------------------

def test_archive_creates_dest_directory(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest = svc.archive(transcript)

    assert os.path.isdir(dest)


def test_archive_returns_dest_dir_path(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest = svc.archive(transcript)

    assert dest.startswith(str(tmp_path / ".files"))
    assert "meeting" in dest


def test_archive_writes_txt_file(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest = svc.archive(transcript)

    assert os.path.isfile(os.path.join(dest, "meeting.txt"))


def test_archive_copies_audio_file(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest = svc.archive(transcript)

    assert os.path.isfile(os.path.join(dest, "meeting.wav"))


def test_archive_txt_contains_segment_text(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest = svc.archive(transcript)
    content = open(os.path.join(dest, "meeting.txt")).read()

    assert "Hello everyone" in content
    assert "Thanks for joining" in content


def test_archive_txt_format(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    segments = [Segment(0.0, 5.0, "Hi", "SPEAKER_00", speaker_resolved="Alice")]
    transcript = make_transcript(audio, segments=segments)

    dest = svc.archive(transcript)
    content = open(os.path.join(dest, "meeting.txt")).read()

    assert content == "[00:00 - 00:05] Alice: Hi"


def test_archive_uses_speaker_final_over_resolved(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    seg = Segment(0.0, 5.0, "Hi", "SPEAKER_00", speaker_resolved="Alice")
    seg.speaker_final = "Carol"
    transcript = make_transcript(audio, segments=[seg])

    dest = svc.archive(transcript)
    content = open(os.path.join(dest, "meeting.txt")).read()

    assert "Carol" in content
    assert "Alice" not in content


def test_archive_applies_display_fn(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest = svc.archive(transcript, display_fn=lambda spk: spk.upper())
    content = open(os.path.join(dest, "meeting.txt")).read()

    assert "ALICE" in content
    assert "BOB" in content


def test_archive_does_not_copy_audio_if_already_at_dest(tmp_path):
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    dest1 = svc.archive(transcript)
    mtime_after_first = os.path.getmtime(os.path.join(dest1, "meeting.wav"))

    dest2 = svc.archive(transcript)
    mtime_after_second = os.path.getmtime(os.path.join(dest2, "meeting.wav"))

    assert mtime_after_first == mtime_after_second


def test_archive_is_idempotent_for_txt(tmp_path):
    """Archiving the same transcript twice overwrites the .txt without error."""
    svc = make_service(tmp_path)
    audio = make_audio(tmp_path)
    transcript = make_transcript(audio)

    svc.archive(transcript)
    svc.archive(transcript)


# ---------------------------------------------------------------------------
# format_time()
# ---------------------------------------------------------------------------

def test_format_time_zero():
    assert format_time(0) == "00:00"


def test_format_time_under_one_minute():
    assert format_time(45) == "00:45"


def test_format_time_exact_one_minute():
    assert format_time(60) == "01:00"


def test_format_time_minutes_and_seconds():
    assert format_time(125) == "02:05"


def test_format_time_over_one_hour():
    assert format_time(3661) == "01:01:01"


def test_format_time_exact_one_hour():
    assert format_time(3600) == "01:00:00"
