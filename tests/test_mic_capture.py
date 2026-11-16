"""The microphone side of AudioCaptureService, and a recording of both tracks.

The backend records the microphone the way it records system audio: one
capture process per track (parec on Linux), started and stopped by the
service; stop_recording() lines the tracks up and leaves one file in
recordings/. No real process runs: Popen and subprocess.run are replaced.
"""
import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.audio_capture_service import AudioCaptureService

_SVC = "app.services.audio_capture_service"


@pytest.fixture(autouse=True)
def _temp_in_tmp_path(tmp_path, monkeypatch):
    monkeypatch.setattr(f"{_SVC}.tempfile.gettempdir", lambda: str(tmp_path))


@pytest.fixture(autouse=True)
def _linux_without_pactl():
    """parec on PATH, pactl not; Linux driver."""
    with patch(f"{_SVC}.shutil.which",
               side_effect=lambda name: None if name == "pactl" else f"/usr/bin/{name}"), \
         patch(f"{_SVC}.sys.platform", "linux"):
        yield


def _with_pactl():
    return patch(f"{_SVC}.shutil.which", side_effect=lambda name: f"/usr/bin/{name}")


def _result(stdout: str, returncode: int = 0):
    result = MagicMock()
    result.stdout = stdout
    result.returncode = returncode
    return result


_SOURCES_JSON = json.dumps([
    {"name": "alsa_output.usb-maono.iec958-stereo.monitor",
     "description": "Monitor of Maono Dynamic Microphone Digital Stereo (IEC958)",
     "monitor_source": "alsa_output.usb-maono.iec958-stereo"},
    {"name": "alsa_input.usb-maono.analog-stereo",
     "description": "Maono Dynamic Microphone Analog Stereo", "monitor_source": ""},
    {"name": "alsa_input.usb-c922.iec958-stereo",
     "description": "C922 Pro Stream Webcam Digital Stereo (IEC958)", "monitor_source": ""},
    {"name": "alsa_input.no-description", "description": "", "monitor_source": ""},
])

_SOURCES_TEXT = """Source #63
\tName: alsa_output.usb-maono.iec958-stereo.monitor
\tDescription: Monitor of Maono Dynamic Microphone Digital Stereo (IEC958)
\tMonitor of Sink: alsa_output.usb-maono.iec958-stereo

Source #64
\tName: alsa_input.usb-maono.analog-stereo
\tDescription: Maono Dynamic Microphone Analog Stereo
\tMonitor of Sink: n/a

Source #65
\tName: alsa_input.usb-c922.iec958-stereo
\tMonitor of Sink: n/a
"""


def _fake_pactl(sources_json=None, sources_text=None):
    def _run(cmd, **_kwargs):
        if cmd[1:] == ["-f", "json", "list", "sources"]:
            return _result(sources_json) if sources_json is not None else _result("", 1)
        if cmd[1:] == ["list", "sources"]:
            return _result(sources_text) if sources_text is not None else _result("", 1)
        if cmd[1:] == ["-f", "json", "list", "sinks"]:
            return _result("[]")
        raise AssertionError(f"unexpected command {cmd}")
    return _run


def _inputs(run):
    with _with_pactl(), patch(f"{_SVC}.subprocess.run", side_effect=run):
        return AudioCaptureService().get_inputs()


# ── Listing the microphones ──────────────────────────────────────────────────

def test_linux_inputs_are_the_sources_that_are_not_monitors_by_name():
    """The default microphone is not listed: the UI offers it itself (null)."""
    assert _inputs(_fake_pactl(sources_json=_SOURCES_JSON)) == [
        {"id": "alsa_input.usb-c922.iec958-stereo", "label": "C922 Pro Stream Webcam Digital Stereo (IEC958)"},
        {"id": "alsa_input.usb-maono.analog-stereo", "label": "Maono Dynamic Microphone Analog Stereo"},
        {"id": "alsa_input.no-description", "label": "no-description"},
    ]


def test_linux_inputs_fall_back_to_the_text_list_without_json():
    assert _inputs(_fake_pactl(sources_text=_SOURCES_TEXT)) == [
        {"id": "alsa_input.usb-maono.analog-stereo", "label": "Maono Dynamic Microphone Analog Stereo"},
        {"id": "alsa_input.usb-c922.iec958-stereo", "label": "usb-c922.iec958-stereo"},
    ]


def test_linux_inputs_are_empty_without_pactl_or_when_it_fails():
    assert AudioCaptureService().get_inputs() == []
    assert _inputs(_fake_pactl()) == []


# ── Recording the microphone ─────────────────────────────────────────────────

def test_linux_microphone_is_recorded_mono_with_parec():
    cmd = AudioCaptureService()._build_command("alsa_input.x", "/tmp/mic.wav", kind="mic")
    assert Path(cmd[0]).name == "parec"
    assert cmd[cmd.index("-d") + 1] == "alsa_input.x"
    assert "--file-format=wav" in cmd
    assert "--rate=48000" in cmd
    assert "--channels=1" in cmd
    assert any(a.startswith("--latency-msec=") for a in cmd)
    assert cmd[-1] == "/tmp/mic.wav"


def test_linux_default_microphone_is_the_default_source():
    cmd = AudioCaptureService()._build_command(None, "/tmp/mic.wav", kind="mic")
    assert cmd[cmd.index("-d") + 1] == "@DEFAULT_SOURCE@"


def test_linux_start_with_a_vanished_microphone_fails(tmp_path):
    with _with_pactl(), \
         patch(f"{_SVC}.subprocess.run", side_effect=_fake_pactl(sources_json=_SOURCES_JSON)), \
         patch(f"{_SVC}.subprocess.Popen") as popen:
        svc = AudioCaptureService(recordings_dir=tmp_path)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture("alsa_input.unplugged", kind="mic")
    assert "microphone" in str(exc.value).lower()
    assert "not available" in str(exc.value)
    popen.assert_not_called()


def test_linux_start_with_a_listed_or_default_microphone_is_allowed(tmp_path):
    with _with_pactl(), \
         patch(f"{_SVC}.subprocess.run", side_effect=_fake_pactl(sources_json=_SOURCES_JSON)), \
         patch(f"{_SVC}.subprocess.Popen", side_effect=lambda *a, **k: _process()):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        assert svc.start_capture("alsa_input.usb-maono.analog-stereo", kind="mic")
        assert svc.start_capture(None, kind="mic")


def test_microphone_capture_goes_to_its_own_temp_file(tmp_path):
    outputs = []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs)):
        svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
        svc.start_capture(None, kind="mic")
        svc.start_capture(None)
    assert Path(outputs[0]).name.startswith("sonorus-mic-")
    assert Path(outputs[1]).name.startswith("sonorus-sys-")


# ── Stopping a recording of one or both tracks ───────────────────────────────

def _process(exit_code=None):
    """A capture process: running (poll() is None) unless exit_code is given."""
    proc = MagicMock()
    state = {"code": exit_code}

    def _wait(timeout=None):
        if state["code"] is None and timeout is not None and timeout < 1:
            raise subprocess.TimeoutExpired("capture", timeout)
        state["code"] = 0 if state["code"] is None else state["code"]
        return state["code"]

    proc.wait = MagicMock(side_effect=_wait)
    proc.poll = MagicMock(side_effect=lambda: state["code"])
    proc.kill = MagicMock(side_effect=lambda: state.update(code=-9))
    return proc


def _writing_popen(outputs, procs=None):
    """Popen that 'records' a small WAV into the output path."""
    def _popen(cmd, **_kwargs):
        out = cmd[-1]
        Path(out).write_bytes(b"RIFF" + b"\0" * 100)
        outputs.append(out)
        proc = _process()
        if procs is not None:
            procs.append(proc)
        return proc
    return _popen


def _ffmpeg(calls):
    def _run(cmd, **_kwargs):
        calls.append(cmd)
        Path(cmd[-1]).write_bytes(b"RIFF" + b"\0" * 200)
    return _run


def test_microphone_only_recording_is_moved_into_recordings_as_is(tmp_path):
    rec = tmp_path / "recordings"
    outputs, calls = [], []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs)), \
         patch(f"{_SVC}.subprocess.run", side_effect=_ffmpeg(calls)):
        svc = AudioCaptureService(recordings_dir=rec)
        mic = svc.start_capture(None, kind="mic")
        final = svc.stop_recording(mic_job=mic)
    assert Path(final).parent == rec
    assert Path(final).name == f"sonorus-rec-{mic}.wav"
    assert Path(final).read_bytes().startswith(b"RIFF")
    assert calls == [], "a microphone alone is kept as recorded"
    assert not Path(outputs[0]).exists()
    assert svc.has_active_jobs() is False


def test_system_only_recording_is_levelled_into_recordings(tmp_path):
    rec = tmp_path / "recordings"
    outputs, calls = [], []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs)), \
         patch(f"{_SVC}.subprocess.run", side_effect=_ffmpeg(calls)):
        svc = AudioCaptureService(recordings_dir=rec)
        system = svc.start_capture(None)
        final = svc.stop_recording(system_job=system)
    assert Path(final).parent == rec
    assert len(calls) == 1 and "amix" not in " ".join(calls[0])
    assert not Path(outputs[0]).exists()


def test_both_tracks_are_mixed_with_the_microphone_shifted_by_its_later_start(tmp_path):
    rec = tmp_path / "recordings"
    outputs, calls, procs = [], [], []
    starts = [1000.0, 1000.25]
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs, procs)), \
         patch(f"{_SVC}.subprocess.run", side_effect=_ffmpeg(calls)), \
         patch(f"{_SVC}.time.time", side_effect=lambda: starts.pop(0) if starts else 2000.0):
        svc = AudioCaptureService(recordings_dir=rec)
        system = svc.start_capture(None)
        mic = svc.start_capture(None, kind="mic")
        final = svc.stop_recording(system_job=system, mic_job=mic)
    assert Path(final).parent == rec
    assert len(calls) == 1
    graph = calls[0][calls[0].index("-filter_complex") + 1]
    assert "amix" in graph
    assert "adelay=delays=250:all=1" in graph.split("[mic]")[0].split("[1:a]")[1]
    for out in outputs:
        assert not Path(out).exists(), f"{out} left behind"
    for proc in procs:
        proc.send_signal.assert_called_once()
    assert svc.has_active_jobs() is False


def test_an_empty_microphone_track_fails_the_stop_with_a_microphone_message(tmp_path):
    def _popen(cmd, **_kwargs):
        Path(cmd[-1]).write_bytes(b"")
        return _process()
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_popen):
        svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
        mic = svc.start_capture(None, kind="mic")
        with pytest.raises(RuntimeError) as exc:
            svc.stop_recording(mic_job=mic)
    assert "microphone" in str(exc.value).lower()


def test_stop_recording_without_a_track_or_with_an_unknown_job_raises(tmp_path):
    svc = AudioCaptureService(recordings_dir=tmp_path)
    with pytest.raises(ValueError):
        svc.stop_recording()
    with pytest.raises(ValueError):
        svc.stop_recording(mic_job="nope")


# ── A process that ends by itself, and letting go of a capture ───────────────

def test_alive_tells_whether_the_capture_process_still_runs(tmp_path):
    procs = []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen([], procs)):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        mic = svc.start_capture(None, kind="mic")
    assert svc.alive(mic) is True
    procs[0].kill()
    assert svc.alive(mic) is False
    assert svc.alive("unknown") is False


def test_a_track_whose_process_ended_by_itself_is_still_saved(tmp_path):
    """A source lost mid-recording: what was recorded up to then is kept."""
    procs, outputs = [], []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs, procs)):
        svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
        mic = svc.start_capture(None, kind="mic")
        procs[0].kill()
        final = svc.stop_recording(mic_job=mic)
    assert Path(final).is_file()


def test_discard_kills_the_process_and_removes_its_files(tmp_path):
    procs, outputs = [], []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs, procs)):
        svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
        mic = svc.start_capture(None, kind="mic")
        svc.discard(mic)
        svc.discard("unknown")
    procs[0].kill.assert_called()
    assert not Path(outputs[0]).exists()
    assert svc.has_active_jobs() is False


def test_discard_all_lets_go_of_every_capture(tmp_path):
    procs, outputs = [], []
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen(outputs, procs)):
        svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
        svc.start_capture(None, kind="mic")
        svc.start_capture(None)
        svc.discard_all()
    assert svc.has_active_jobs() is False
    assert not any(Path(o).exists() for o in outputs)


def test_started_at_is_when_the_track_starts(tmp_path):
    with patch(f"{_SVC}.subprocess.Popen", side_effect=_writing_popen([])), \
         patch(f"{_SVC}.time.time", return_value=1234.5):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        mic = svc.start_capture(None, kind="mic")
    assert svc.started_at(mic) == 1234.5
