"""Mixing the microphone with system audio (AudioCaptureService._merge).

The app starts the system capture first (the backend waits _START_CHECK_SEC
to see it running) and the MediaRecorder only after that; on Stop the
microphone stops first, its file is uploaded, then the system capture
stops. So the system track is longer at both ends: the mix shifts the
microphone by the difference of the two start times and ends with it, where
Stop was pressed.

The tracks here are tones that stand for speech: 440 Hz system audio with a
1 kHz marker, 2 kHz on the microphone. No models are needed.
"""
import shutil
import wave

import numpy as np
import pytest

from app.services.audio_capture_service import _START_CHECK_SEC, AudioCaptureService

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

SR = 48000
START_DELAY = _START_CHECK_SEC  # the least the microphone starts after the system capture
STOP_DELAY = 1.0                # upload of the mic recording before the system capture stops
MIC_SECONDS = 8.0


def _tone(freq, seconds, amp=0.3):
    t = np.arange(int(seconds * SR)) / SR
    return amp * np.sin(2 * np.pi * freq * t)


def _write(path, x):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.round(np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def _read(path):
    with wave.open(str(path)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768
        return x.reshape(-1, w.getnchannels()).mean(axis=1), w.getframerate()


def _band_energy(x, sr, freq, start, end):
    seg = x[int(start * sr):int(end * sr)]
    if len(seg) == 0:
        return 0.0
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    return float(spec[(f > freq - 30) & (f < freq + 30)].sum() / len(seg))


def _merge(tmp_path, system, mic, mic_delay=START_DELAY):
    _write(tmp_path / "system.wav", system)
    _write(tmp_path / "mic.wav", mic)
    AudioCaptureService(recordings_dir=tmp_path)._merge(
        str(tmp_path / "system.wav"), str(tmp_path / "mic.wav"), str(tmp_path / "merged.wav"),
        mic_delay=mic_delay)
    return _read(tmp_path / "merged.wav")


def test_system_audio_just_before_stop_is_kept(tmp_path):
    system_seconds = START_DELAY + MIC_SECONDS + STOP_DELAY
    stop = START_DELAY + MIC_SECONDS            # Stop pressed, in system-track time
    system = _tone(440, system_seconds, 0.05)
    a, b = int((stop - 0.4) * SR), int((stop - 0.1) * SR)  # said 0.4–0.1 s before Stop
    system[a:b] += _tone(1000, (b - a) / SR)
    merged, sr = _merge(tmp_path, system, _tone(2000, MIC_SECONDS, 0.05))
    end = len(merged) / sr
    assert _band_energy(merged, sr, 1000, end - 0.6, end) > 10 * _band_energy(merged, sr, 1000, 0, 1.0), \
        f"the 1 kHz marker said just before Stop is not in the {end:.2f} s mix"


def test_microphone_and_system_audio_stay_in_sync(tmp_path):
    system = _tone(440, START_DELAY + MIC_SECONDS + STOP_DELAY, 0.02)
    mic = _tone(2000, MIC_SECONDS, 0.02)
    event = 4.0                                    # same moment in system-track time…
    s = int(event * SR)
    system[s:s + SR // 10] += _tone(1000, 0.1)
    m = int((event - START_DELAY) * SR)            # …is START_DELAY earlier on the mic track
    mic[m:m + SR // 10] += _tone(3000, 0.1)
    merged, sr = _merge(tmp_path, system, mic)

    def onset(freq):
        frames = np.arange(0, len(merged) / sr - 0.05, 0.01)
        energy = [_band_energy(merged, sr, freq, t, t + 0.05) for t in frames]
        return frames[int(np.argmax(energy))]

    offset = abs(onset(1000) - onset(3000))
    assert offset < 0.05, f"mic and system audio of the same moment are {offset:.2f} s apart in the mix"


def test_the_mix_ends_where_stop_was_pressed(tmp_path):
    """System audio captured after Stop, while the microphone was uploaded, is not kept."""
    system = _tone(440, START_DELAY + MIC_SECONDS + STOP_DELAY, 0.05)
    merged, sr = _merge(tmp_path, system, _tone(2000, MIC_SECONDS, 0.05))
    assert abs(len(merged) / sr - (START_DELAY + MIC_SECONDS)) < 0.05


def test_a_microphone_that_started_first_is_not_cut(tmp_path):
    """The other way round, the system track is the one shifted."""
    system = _tone(440, MIC_SECONDS, 0.02)
    mic = _tone(2000, MIC_SECONDS + 0.3, 0.02)
    s = int(3.0 * SR)
    system[s:s + SR // 10] += _tone(1000, 0.1)
    m = int(3.3 * SR)
    mic[m:m + SR // 10] += _tone(3000, 0.1)
    merged, sr = _merge(tmp_path, system, mic, mic_delay=-0.3)

    def onset(freq):
        frames = np.arange(0, len(merged) / sr - 0.05, 0.01)
        return frames[int(np.argmax([_band_energy(merged, sr, freq, t, t + 0.05) for t in frames]))]

    assert abs(onset(1000) - onset(3000)) < 0.05
    assert abs(len(merged) / sr - (MIC_SECONDS + 0.3)) < 0.05


def test_a_mono_microphone_keeps_the_mix_in_stereo(tmp_path):
    """The mix takes its layout from its first input, the microphone."""
    with wave.open(str(tmp_path / "system.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.repeat(np.round(_tone(440, 3.0) * 32767).astype("<i2"), 2).tobytes())
    _write(tmp_path / "mic.wav", _tone(2000, 2.0))
    AudioCaptureService(recordings_dir=tmp_path)._merge(
        str(tmp_path / "system.wav"), str(tmp_path / "mic.wav"), str(tmp_path / "merged.wav"),
        mic_delay=0.5)
    with wave.open(str(tmp_path / "merged.wav")) as w:
        assert w.getnchannels() == 2
