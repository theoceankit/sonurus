"""SilenceWatch: whether every track of a live recording has been quiet for
a while, read from the WAV files the capture processes are still writing."""
import struct

import numpy as np

from app.services.track_silence import SilenceWatch


def _header(channels=1, rate=48000, bits=16, fmt=1):
    block = channels * bits // 8
    fmt_chunk = struct.pack("<HHIIHH", fmt, channels, rate, rate * block, block, bits)
    # Sizes left at 0, as a capture still writing leaves them.
    return b"RIFF" + struct.pack("<I", 0) + b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt_chunk \
        + b"data" + struct.pack("<I", 0)


def _int16(seconds, level_db, rate=48000, channels=1):
    n = int(seconds * rate)
    amplitude = 32767 * 10 ** (level_db / 20) * np.sqrt(2)
    tone = amplitude * np.sin(2 * np.pi * 440 * np.arange(n) / rate)
    return np.repeat(tone.astype(np.int16), channels).tobytes()


def _float32(seconds, level_db, rate=48000):
    n = int(seconds * rate)
    amplitude = 10 ** (level_db / 20) * np.sqrt(2)
    return (amplitude * np.sin(2 * np.pi * 440 * np.arange(n) / rate)).astype(np.float32).tobytes()


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def _track(tmp_path, name, **header):
    path = tmp_path / name
    path.write_bytes(_header(**header))
    return path


def _append(path, data):
    with open(path, "ab") as f:
        f.write(data)


def test_quiet_tracks_for_the_whole_while_are_silent(tmp_path):
    mic, system = _track(tmp_path, "mic.wav"), _track(tmp_path, "sys.wav", channels=2)
    clock = Clock()
    watch = SilenceWatch([str(mic), str(system)], after=300, clock=clock)
    for second in range(1, 301):
        _append(mic, _int16(1, -70))
        _append(system, _int16(1, -70, channels=2))
        clock.now = float(second)
        silent = watch.check()
        assert silent == (second >= 300), second


def test_sound_on_one_track_is_not_silence(tmp_path):
    mic, system = _track(tmp_path, "mic.wav"), _track(tmp_path, "sys.wav")
    clock = Clock()
    watch = SilenceWatch([str(mic), str(system)], after=300, clock=clock)
    _append(mic, _int16(200, -70))
    _append(system, _int16(199, -70) + _int16(1, -30))
    clock.now = 200.0
    assert not watch.check()
    _append(mic, _int16(299, -70))
    _append(system, _int16(299, -70))
    clock.now = 499.0
    assert not watch.check()
    clock.now = 500.0
    assert watch.check()


def test_float_tracks_are_read_too(tmp_path):
    track = _track(tmp_path, "sys.wav", bits=32, fmt=3)
    clock = Clock()
    watch = SilenceWatch([str(track)], after=10, clock=clock)
    _append(track, _float32(10, -30))
    clock.now = 10.0
    assert not watch.check()


def test_a_track_with_no_header_yet_is_waited_for(tmp_path):
    track = tmp_path / "mic.wav"
    track.write_bytes(b"RIF")
    clock = Clock()
    watch = SilenceWatch([str(track)], after=10, clock=clock)
    clock.now = 5.0
    assert not watch.check()
    track.write_bytes(_header() + _int16(1, -20))
    clock.now = 11.0
    assert not watch.check()


def test_a_frame_cut_in_the_middle_is_read_with_the_next_bytes(tmp_path):
    track = _track(tmp_path, "sys.wav", channels=2)
    clock = Clock()
    watch = SilenceWatch([str(track)], after=10, clock=clock)
    # Read out of step with the frames, quiet samples would come out as loud noise.
    quiet = _int16(12, -70, channels=2)
    _append(track, quiet[:12345])
    watch.check()
    _append(track, quiet[12345:])
    clock.now = 10.5
    assert watch.check()


# ── Digital silence: a track with not one sample that is not zero ─────────────
#
# A macOS system track the system may not record holds zeros only: a hint to
# allow it, not an error, as nothing playing gives the same.

def test_a_track_of_zeros_only_is_digital_silence(tmp_path):
    from app.services.track_silence import only_zeros
    track = _track(tmp_path, "sys.wav", channels=2)
    _append(track, bytes(48000 * 2 * 2 * 3))
    assert only_zeros(str(track))


def test_one_sample_that_is_not_zero_is_not_digital_silence(tmp_path):
    from app.services.track_silence import only_zeros
    track = _track(tmp_path, "sys.wav", channels=2)
    # Far below anything SilenceWatch calls loud, and still a sound.
    _append(track, bytes(48000 * 4 * 2) + struct.pack("<hh", 0, 1) + bytes(4000))
    assert not only_zeros(str(track))


def test_float_zeros_are_digital_silence_too(tmp_path):
    from app.services.track_silence import only_zeros
    track = _track(tmp_path, "sys.wav", bits=32, fmt=3)
    _append(track, bytes(48000 * 4))
    assert only_zeros(str(track))
    _append(track, _float32(0.1, -90))
    assert not only_zeros(str(track))


def test_a_track_that_cannot_be_read_is_not_called_silent(tmp_path):
    from app.services.track_silence import only_zeros
    assert not only_zeros(str(tmp_path / "missing.wav"))
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"RIF")
    assert not only_zeros(str(broken))


def test_a_header_with_no_samples_heard_nothing(tmp_path):
    from app.services.track_silence import only_zeros
    assert only_zeros(str(_track(tmp_path, "sys.wav")))
