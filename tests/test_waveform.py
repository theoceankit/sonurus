"""Tests for app/services/waveform.py — loudness levels of a recording for the
player's waveform, worked out with ffmpeg and cached next to the audio."""
import math
import shutil
import struct
import threading
import time
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from app.services import waveform
from app.services.audio_store import discard_levels, levels_path, remove_orphan_levels
from app.services.waveform import FLOOR_DB, WINDOWS_PER_SECOND, bar_levels, ensure_levels


@pytest.fixture
def recordings(tmp_path):
    d = tmp_path / "data" / "recordings"
    d.mkdir(parents=True)
    return d


def _db(*values):
    return np.array(values, dtype=np.float32)


def _per_second(*seconds_db):
    """Windows for whole seconds, each second at one level."""
    return np.repeat(np.array(seconds_db, dtype=np.float32), WINDOWS_PER_SECOND)


# ── bar_levels() ──────────────────────────────────────────────────────────────

def test_bar_levels_gives_one_level_per_bar_between_0_and_1():
    levels = bar_levels(_per_second(-20, -40, -60, -20), bars=4, start=0, end=4)

    assert len(levels) == 4
    assert all(0 <= level <= 1 for level in levels)
    assert levels[0] == levels[3] == 1
    assert levels[0] > levels[1] > levels[2]


def test_bar_levels_are_relative_to_the_loud_part_of_the_recording():
    loud = bar_levels(_per_second(-10, -30), bars=2, start=0, end=2)
    quiet = bar_levels(_per_second(-40, -60), bars=2, start=0, end=2)

    assert quiet == pytest.approx(loud, abs=0.01), "a quiet recording must not look empty"


def test_silence_is_zero():
    levels = bar_levels(_per_second(-20, FLOOR_DB), bars=2, start=0, end=2)

    assert levels[1] == 0


def test_all_silent_recording_is_all_zero():
    assert bar_levels(_per_second(FLOOR_DB, FLOOR_DB), bars=3, start=0, end=2) == [0, 0, 0]


def test_empty_recording_is_all_zero():
    assert bar_levels(_db(), bars=3, start=0, end=2) == [0, 0, 0]


def test_a_bar_averages_power_not_decibels():
    # One loud second and one silent one: the mean power is half the loud one,
    # 3 dB below it, not halfway between in decibels.
    levels = bar_levels(_per_second(-20, FLOOR_DB, -20, -20), bars=2, start=0, end=4)

    assert levels[0] == pytest.approx(1 - 3.01 / waveform.RANGE_DB, abs=0.01)
    assert levels[1] == 1


def test_bars_past_the_end_of_the_audio_are_zero():
    levels = bar_levels(_per_second(-20, -20), bars=4, start=0, end=4)

    assert levels == [1, 1, 0, 0]


def test_a_clip_takes_its_own_stretch_but_the_scale_of_the_whole_recording():
    db = _per_second(-10, -10, -30, -30)

    clip = bar_levels(db, bars=2, start=2, end=4)

    assert clip[0] == clip[1]
    assert clip[0] < 1, "the clip is quieter than the loud part of its recording"


def test_bars_narrower_than_a_window_take_the_window_they_fall_in():
    db = _per_second(-20, -50)

    levels = bar_levels(db, bars=40, start=0.5, end=1.5)

    assert len(levels) == 40
    assert levels[0] == 1 and levels[-1] < 1


def test_bar_levels_rejects_an_empty_stretch():
    with pytest.raises(ValueError):
        bar_levels(_per_second(-20), bars=2, start=1, end=1)


# ── Cache ─────────────────────────────────────────────────────────────────────

def test_levels_path_is_next_to_the_audio(recordings):
    audio = recordings / "sonorus-import-1.mp3"

    assert levels_path(audio) == recordings / "sonorus-import-1.mp3.levels"


def _audio(recordings, name="sonorus-rec-1.wav"):
    p = recordings / name
    p.write_bytes(b"audio")
    return p


def test_ensure_levels_computes_once_and_caches_next_to_the_audio(recordings):
    audio = _audio(recordings)
    computed = _db(-20, -30, FLOOR_DB, -60.5)

    with patch.object(waveform, "compute_levels", return_value=computed) as compute:
        first = ensure_levels(str(audio), recordings)
        second = ensure_levels(str(audio), recordings)

    compute.assert_called_once_with(str(audio))
    assert levels_path(audio).is_file()
    np.testing.assert_allclose(first, computed, atol=0.2)
    np.testing.assert_allclose(second, computed, atol=0.2)


def test_cache_is_small(recordings):
    audio = _audio(recordings)
    hour = np.full(3600 * WINDOWS_PER_SECOND, -20, dtype=np.float32)

    with patch.object(waveform, "compute_levels", return_value=hour):
        ensure_levels(str(audio), recordings)

    assert levels_path(audio).stat().st_size < 3600 * WINDOWS_PER_SECOND + 64


def test_a_broken_cache_is_computed_again(recordings):
    audio = _audio(recordings)
    levels_path(audio).write_bytes(b"not a levels file")

    with patch.object(waveform, "compute_levels", return_value=_db(-20)) as compute:
        ensure_levels(str(audio), recordings)

    compute.assert_called_once()


def test_a_failed_computation_leaves_no_cache(recordings):
    audio = _audio(recordings)

    with patch.object(waveform, "compute_levels", side_effect=waveform.WaveformError("bad audio")):
        with pytest.raises(waveform.WaveformError):
            ensure_levels(str(audio), recordings)

    assert list(recordings.iterdir()) == [audio]


def test_two_requests_at_once_compute_once(recordings):
    audio = _audio(recordings)
    calls = []

    def slow(path):
        calls.append(path)
        time.sleep(0.2)
        return _db(-20, -30)

    results = []
    with patch.object(waveform, "compute_levels", side_effect=slow):
        threads = [threading.Thread(target=lambda: results.append(ensure_levels(str(audio), recordings)))
                   for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    assert len(calls) == 1
    assert len(results) == 2


def test_audio_outside_recordings_is_not_cached(recordings, tmp_path):
    outside = tmp_path / "imported" / "talk.wav"
    outside.parent.mkdir()
    outside.write_bytes(b"audio")

    with patch.object(waveform, "compute_levels", return_value=_db(-20)):
        ensure_levels(str(outside), recordings)

    assert list(outside.parent.iterdir()) == [outside]


def test_missing_audio_raises_file_not_found(recordings):
    with patch.object(waveform, "compute_levels") as compute:
        with pytest.raises(FileNotFoundError):
            ensure_levels(str(recordings / "gone.wav"), recordings)
    compute.assert_not_called()


def test_discard_levels_removes_the_cache_only(recordings):
    audio = _audio(recordings)
    levels_path(audio).write_bytes(b"x")

    discard_levels(str(audio))
    discard_levels(str(audio))  # nothing left: no error

    assert audio.exists()
    assert not levels_path(audio).exists()


def test_remove_orphan_levels_keeps_the_cache_of_existing_audio(recordings):
    kept = _audio(recordings, "sonorus-import-1.mp3")
    levels_path(kept).write_bytes(b"x")
    levels_path(recordings / "sonorus-rec-gone.wav").write_bytes(b"x")
    (recordings / "sonorus-rec-2.wav.levels.part").write_bytes(b"x")

    assert remove_orphan_levels(recordings) == 2

    assert sorted(p.name for p in recordings.iterdir()) == ["sonorus-import-1.mp3", "sonorus-import-1.mp3.levels"]


def test_remove_orphan_levels_without_a_recordings_dir(tmp_path):
    assert remove_orphan_levels(tmp_path / "missing") == 0


# ── compute_levels() with the real ffmpeg ─────────────────────────────────────

def _wav(path, seconds_amplitude, rate=16000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for seconds, amplitude in seconds_amplitude:
            for i in range(int(seconds * rate)):
                frames += struct.pack("<h", int(amplitude * 32767 * math.sin(2 * math.pi * 440 * i / rate)))
        w.writeframes(bytes(frames))


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_compute_levels_reads_the_audio_with_ffmpeg(tmp_path):
    audio = tmp_path / "tone.wav"
    _wav(audio, [(1, 0), (1, 0.5)])

    db = waveform.compute_levels(str(audio))

    assert len(db) == pytest.approx(2 * WINDOWS_PER_SECOND, abs=1)
    assert db[: WINDOWS_PER_SECOND - 2].max() == FLOOR_DB
    # A sine of amplitude 0.5 has an RMS of 0.5 / √2, about −9 dBFS.
    assert np.median(db[WINDOWS_PER_SECOND + 2:]) == pytest.approx(-9, abs=1)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_compute_levels_fails_on_a_file_that_is_not_audio(tmp_path):
    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not audio at all")

    with pytest.raises(waveform.WaveformError):
        waveform.compute_levels(str(bad))


def test_compute_levels_without_ffmpeg_is_a_waveform_error(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")

    with patch.object(waveform, "_ffmpeg", return_value=str(tmp_path / "no-ffmpeg")):
        with pytest.raises(waveform.WaveformError):
            waveform.compute_levels(str(audio))
