"""Tests for app/services/audio_store.py — app-owned copies of imported audio."""
from pathlib import Path

import pytest

from app.services.audio_store import (
    discard_import,
    discard_owned_audio,
    import_audio,
    is_import_copy,
    remove_orphan_imports,
)


@pytest.fixture
def recordings(tmp_path):
    return tmp_path / "data" / "recordings"


def _audio(tmp_path, name="Team Meeting.WAV", data=b"audio-bytes"):
    p = tmp_path / "imported" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


# ── import_audio() ────────────────────────────────────────────────────────────

def test_import_copies_into_recordings_with_unique_name(tmp_path, recordings):
    src = _audio(tmp_path)

    dest = Path(import_audio(str(src), recordings))

    assert dest.parent == recordings
    assert dest.name.startswith("sonorus-import-")
    assert dest.suffix == ".wav"
    assert dest.read_bytes() == b"audio-bytes"
    assert src.read_bytes() == b"audio-bytes", "the original must be kept"


def test_import_same_file_twice_gives_two_copies(tmp_path, recordings):
    src = _audio(tmp_path)

    a = import_audio(str(src), recordings)
    b = import_audio(str(src), recordings)

    assert a != b
    assert Path(a).exists() and Path(b).exists()


def test_import_file_without_extension(tmp_path, recordings):
    src = _audio(tmp_path, name="voice-memo")

    dest = Path(import_audio(str(src), recordings))

    assert dest.name.startswith("sonorus-import-")
    assert dest.suffix == ""


def test_import_keeps_file_already_in_recordings(recordings):
    recordings.mkdir(parents=True)
    rec = recordings / "sonorus-rec-1.wav"
    rec.write_bytes(b"x")

    assert import_audio(str(rec), recordings) == str(rec)
    assert [p.name for p in recordings.iterdir()] == ["sonorus-rec-1.wav"]


def test_import_follows_a_symlink_to_its_content(tmp_path, recordings):
    src = _audio(tmp_path)
    link = tmp_path / "link.wav"
    link.symlink_to(src)

    dest = Path(import_audio(str(link), recordings))

    assert not dest.is_symlink()
    assert dest.read_bytes() == b"audio-bytes"


def test_import_failure_leaves_no_partial_copy(tmp_path, recordings, monkeypatch):
    import app.services.audio_store as audio_store
    src = _audio(tmp_path)

    def boom(s, d, *a, **k):
        Path(d).write_bytes(b"part")
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(audio_store.shutil, "copy2", boom)

    with pytest.raises(OSError):
        import_audio(str(src), recordings)
    assert list(recordings.iterdir()) == []


# ── is_import_copy() / discard_import() ───────────────────────────────────────

def test_is_import_copy(tmp_path, recordings):
    copy = import_audio(str(_audio(tmp_path)), recordings)

    assert is_import_copy(copy, recordings)
    assert not is_import_copy(str(recordings / "sonorus-rec-1.wav"), recordings)
    assert not is_import_copy(str(tmp_path / "sonorus-import-x.wav"), recordings)


def test_discard_import_removes_the_copy(tmp_path, recordings):
    src = _audio(tmp_path)
    copy = import_audio(str(src), recordings)

    discard_import(copy, recordings)

    assert not Path(copy).exists()
    assert src.exists()


def test_discard_import_never_touches_live_recordings_or_originals(tmp_path, recordings):
    recordings.mkdir(parents=True)
    rec = recordings / "sonorus-rec-1.wav"
    rec.write_bytes(b"x")
    src = _audio(tmp_path)

    discard_import(str(rec), recordings)
    discard_import(str(src), recordings)
    discard_import(str(recordings / "sonorus-import-missing.wav"), recordings)

    assert rec.exists()
    assert src.exists()


# ── discard_owned_audio() ─────────────────────────────────────────────────────

def test_discard_owned_audio_removes_copies_and_live_recordings(tmp_path, recordings):
    rec = recordings / "sonorus-rec-1.webm"
    rec.parent.mkdir(parents=True)
    rec.write_bytes(b"x")
    copy = import_audio(str(_audio(tmp_path)), recordings)

    discard_owned_audio(str(rec), recordings)
    discard_owned_audio(copy, recordings)

    assert not rec.exists()
    assert not Path(copy).exists()


def test_discard_owned_audio_never_touches_files_outside_recordings(tmp_path, recordings):
    recordings.mkdir(parents=True)
    src = _audio(tmp_path)
    link = recordings / "sonorus-rec-link.wav"
    outside = tmp_path / "elsewhere.wav"
    outside.write_bytes(b"keep")
    link.symlink_to(outside)

    discard_owned_audio(str(src), recordings)
    discard_owned_audio(str(recordings / "missing.wav"), recordings)
    discard_owned_audio(str(link), recordings)

    assert src.exists()
    assert outside.read_bytes() == b"keep"  # the link goes, its target stays
    assert not link.exists() and not link.is_symlink()


# ── remove_orphan_imports() ───────────────────────────────────────────────────

def test_remove_orphan_imports_keeps_referenced_and_live(tmp_path, recordings):
    kept = import_audio(str(_audio(tmp_path)), recordings)
    orphan = import_audio(str(_audio(tmp_path)), recordings)
    live = recordings / "sonorus-rec-1.wav"
    live.write_bytes(b"x")

    removed = remove_orphan_imports(recordings, {kept})

    assert removed == 1
    assert Path(kept).exists()
    assert not Path(orphan).exists()
    assert live.exists(), "an unreferenced live recording is the only copy — keep it"


def test_remove_orphan_imports_missing_dir_is_noop(recordings):
    assert remove_orphan_imports(recordings, set()) == 0
