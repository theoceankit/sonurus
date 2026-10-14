"""
Tests for AudioCaptureService and /audio/capture/* FastAPI router.

Service tests mock subprocess.Popen so no real process is started.
API tests inject a stub AudioCaptureService via dependency_overrides.
"""
import subprocess
import uuid as uuid_module
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_valid_uuid(value: str) -> bool:
    """Return True if value is a valid UUID (any version)."""
    try:
        uuid_module.UUID(value)
        return True
    except ValueError:
        return False


def _make_mock_popen(alive: bool = True):
    """Return a mock Popen instance with send_signal() and wait().

    A live process outlasts the short start-up check (wait with a timeout
    under a second raises TimeoutExpired); a dead one has already exited.
    """
    proc = MagicMock()
    proc.send_signal = MagicMock()

    def _wait(timeout=None):
        if alive and timeout is not None and timeout < 1:
            raise subprocess.TimeoutExpired("capture", timeout)
        return 0 if alive else 1

    proc.wait = MagicMock(side_effect=_wait)
    return proc


@pytest.fixture(autouse=True)
def _capture_files_in_tmp_path(tmp_path, monkeypatch):
    """Capture logs/outputs go to the test's tmp dir, not the real OS temp dir
    (most tests start a capture with a mocked process and never stop it)."""
    monkeypatch.setattr("app.services.audio_capture_service.tempfile.gettempdir",
                        lambda: str(tmp_path))


@pytest.fixture(autouse=True)
def _capture_tools_installed():
    """Pretend parec is on PATH (CI runners have no PulseAudio tools) and pactl
    is not, so no test depends on the audio devices of the machine running it.
    Tests about source listing patch pactl in with _with_pactl()."""
    with patch("app.services.audio_capture_service.shutil.which",
               side_effect=lambda name: None if name == "pactl" else f"/usr/bin/{name}"):
        yield


def _with_pactl():
    return patch("app.services.audio_capture_service.shutil.which",
                 side_effect=lambda name: f"/usr/bin/{name}")


def _get_audio_capture_service():
    """Import get_audio_capture_service lazily — it does not exist yet."""
    from app.api.dependencies import get_audio_capture_service  # noqa
    return get_audio_capture_service


def _get_service_class():
    """Import AudioCaptureService lazily — it does not exist yet."""
    from app.services.audio_capture_service import AudioCaptureService  # noqa
    return AudioCaptureService


# ── Stub service for API tests ────────────────────────────────────────────────

class _StubAudioCaptureService:
    """Simple stub that records calls and returns predictable values."""

    def __init__(self):
        self._jobs: dict[str, str] = {}  # job_id → system_file_path

    def get_sources(self) -> list[dict]:
        return [{"id": "stub_source", "label": "Stub audio source"}]

    def start_capture(self, source_id=None) -> str:
        job_id = str(uuid_module.uuid4())
        self._jobs[job_id] = f"/tmp/capture_{job_id}.wav"
        return job_id

    def stop_capture(self, job_id: str, mic_path=None) -> str:
        if job_id not in self._jobs:
            raise ValueError("Job not found")
        system_path = self._jobs.pop(job_id)
        if mic_path is not None:
            return f"/tmp/merged_{job_id}.wav"
        return system_path


# ── API fixture ───────────────────────────────────────────────────────────────

@pytest.fixture
def capture_client():
    """TestClient with a stub AudioCaptureService injected via DI override."""
    dep_fn = _get_audio_capture_service()
    stub = _StubAudioCaptureService()

    app.dependency_overrides[dep_fn] = lambda: stub

    yield TestClient(app), stub

    app.dependency_overrides.pop(dep_fn, None)


# ── Service-level tests ───────────────────────────────────────────────────────

def test_start_capture_returns_uuid():
    """start_capture() returns a string that parses as a valid UUID."""
    AudioCaptureService = _get_service_class()

    mock_proc = _make_mock_popen()
    with patch("app.services.audio_capture_service.subprocess.Popen", return_value=mock_proc):
        svc = AudioCaptureService()
        job_id = svc.start_capture()

    assert isinstance(job_id, str), "job_id must be a string"
    assert _is_valid_uuid(job_id), f"job_id must be a valid UUID, got {job_id!r}"


def test_start_capture_multiple_calls_unique_ids():
    """Two consecutive start_capture() calls return different job_ids."""
    AudioCaptureService = _get_service_class()

    mock_proc_1 = _make_mock_popen()
    mock_proc_2 = _make_mock_popen()

    with patch(
        "app.services.audio_capture_service.subprocess.Popen",
        side_effect=[mock_proc_1, mock_proc_2],
    ):
        svc = AudioCaptureService()
        id1 = svc.start_capture()
        id2 = svc.start_capture()

    assert id1 != id2, "Each start_capture() call must return a unique job_id"
    assert _is_valid_uuid(id1)
    assert _is_valid_uuid(id2)


def test_stop_capture_unknown_job_raises():
    """stop_capture() with a nonexistent job_id raises ValueError."""
    AudioCaptureService = _get_service_class()

    svc = AudioCaptureService()
    with pytest.raises(ValueError, match="[Jj]ob not found"):
        svc.stop_capture("nonexistent-job-id")


def test_stop_capture_without_mic_returns_system_file(tmp_path):
    """stop_capture(job_id) without mic_path returns the system audio file path.

    No ffmpeg merge should be performed; the returned path is the capture
    output moved into the recordings dir.
    """
    AudioCaptureService = _get_service_class()

    procs = []
    def _popen(cmd, **kwargs):
        proc = _fake_capture_popen([])(cmd, **kwargs)
        procs.append(proc)
        return proc

    with patch("app.services.audio_capture_service.subprocess.Popen", side_effect=_popen), \
         patch("app.services.audio_capture_service.subprocess.run") as mock_run, \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        job_id = svc.start_capture()
        file_path = svc.stop_capture(job_id)

    assert isinstance(file_path, str), "stop_capture must return a string path"
    assert len(file_path) > 0, "returned path must not be empty"
    mock_run.assert_not_called()
    # SIGINT (or equivalent) must have been sent to the subprocess
    procs[0].send_signal.assert_called_once()
    procs[0].wait.assert_called_with(timeout=10)


def test_stop_capture_with_mic_path_returns_merged_file(tmp_path):
    """stop_capture(job_id, mic_path=...) returns a different (merged) file path.

    When mic_path is provided, the service should merge system + mic audio
    and return a merged output path that differs from the system-only path.
    """
    AudioCaptureService = _get_service_class()

    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen([])), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_run), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        jid_sys = svc.start_capture()
        jid_mic = svc.start_capture()
        path_sys = svc.stop_capture(jid_sys)
        path_merged = svc.stop_capture(jid_mic, mic_path="/tmp/mic.webm")

    assert isinstance(path_merged, str), "merged path must be a string"
    assert len(path_merged) > 0, "merged path must not be empty"
    assert path_merged != path_sys, (
        "merged file path must differ from the system-only capture path"
    )


# ── API-level tests ───────────────────────────────────────────────────────────

def test_get_sources_returns_list(capture_client):
    """GET /audio/capture/sources returns 200 with a 'sources' list."""
    client, _ = capture_client
    r = client.get("/audio/capture/sources")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert "sources" in body, f"Response must contain 'sources' key, got {body}"
    assert isinstance(body["sources"], list), "sources must be a list"
    for src in body["sources"]:
        assert "id" in src, f"Source entry missing 'id': {src}"
        assert "label" in src, f"Source entry missing 'label': {src}"


def test_post_start_returns_job_id(capture_client):
    """POST /audio/capture/start returns 200 with a valid UUID job_id."""
    client, _ = capture_client
    r = client.post("/audio/capture/start")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert "job_id" in body, f"Response must contain 'job_id', got {body}"
    assert _is_valid_uuid(body["job_id"]), (
        f"job_id must be a valid UUID, got {body['job_id']!r}"
    )


def test_post_start_with_source_id_returns_job_id(capture_client):
    """POST /audio/capture/start with body {source_id: ...} returns 200 with UUID."""
    client, _ = capture_client
    r = client.post("/audio/capture/start", json={"source_id": "stub_source"})
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert "job_id" in body
    assert _is_valid_uuid(body["job_id"])


def test_post_stop_returns_file_path(capture_client):
    """POST /audio/capture/stop/{job_id} returns 200 with a file_path string."""
    client, _ = capture_client
    start_r = client.post("/audio/capture/start")
    assert start_r.status_code == 200
    job_id = start_r.json()["job_id"]

    stop_r = client.post(f"/audio/capture/stop/{job_id}")
    assert stop_r.status_code == 200, f"Expected 200, got {stop_r.status_code}: {stop_r.text}"
    body = stop_r.json()
    assert "file_path" in body, f"Response must contain 'file_path', got {body}"
    assert isinstance(body["file_path"], str), "file_path must be a string"
    assert len(body["file_path"]) > 0, "file_path must not be empty"


def test_post_stop_unknown_job_returns_404(capture_client):
    """POST /audio/capture/stop/{unknown} returns 404 when the job_id is not found."""
    client, _ = capture_client
    r = client.post("/audio/capture/stop/nonexistent-job-id")
    assert r.status_code == 404, (
        f"Expected 404 for unknown job_id, got {r.status_code}: {r.text}"
    )


def test_post_stop_with_mic_path(capture_client):
    """POST /audio/capture/stop/{job_id} with body {mic_path: ...} returns 200 with file_path."""
    client, _ = capture_client
    start_r = client.post("/audio/capture/start")
    assert start_r.status_code == 200
    job_id = start_r.json()["job_id"]

    stop_r = client.post(
        f"/audio/capture/stop/{job_id}",
        json={"mic_path": "/tmp/mic.webm"},
    )
    assert stop_r.status_code == 200, f"Expected 200, got {stop_r.status_code}: {stop_r.text}"
    body = stop_r.json()
    assert "file_path" in body, f"Response must contain 'file_path', got {body}"
    assert isinstance(body["file_path"], str)
    assert len(body["file_path"]) > 0


# ── Regression: capture process must never block on a full stderr pipe ───────

# Mimics ffmpeg: writes the output file, then streams progress lines to stderr
# until SIGINT arrives, and only then exits. If stderr is a pipe nobody reads,
# the write blocks once the pipe buffer is full and the process never exits.
_CHATTY_CAPTURE_SCRIPT = r"""
import signal, sys, time
stop = False
def _on_sigint(*_):
    global stop
    stop = True
signal.signal(signal.SIGINT, _on_sigint)
with open(sys.argv[1], "wb") as f:
    f.write(b"RIFF" + b"\0" * 100)
line = b"size=  1024kB time=00:00:10.00 bitrate= 705.6kbits/s speed=1x\n" * 4
while not stop:
    sys.stderr.buffer.write(line)
    sys.stderr.buffer.flush()
    time.sleep(0.001)
"""


@pytest.mark.skipif(__import__("sys").platform == "win32", reason="POSIX signals only")
def test_stop_capture_does_not_hang_on_chatty_stderr(tmp_path):
    import sys
    import threading
    import time

    AudioCaptureService = _get_service_class()
    svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
    script = tmp_path / "chatty.py"
    script.write_text(_CHATTY_CAPTURE_SCRIPT)

    with patch.object(svc, "_build_command",
                      side_effect=lambda _src, out: [sys.executable, str(script), out]), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        job_id = svc.start_capture(source_id="test.monitor")
        time.sleep(1.5)  # far more than a 64 KB pipe buffer worth of output

        result = {}
        t = threading.Thread(target=lambda: result.update(path=svc.stop_capture(job_id)), daemon=True)
        t.start()
        t.join(timeout=15)

    assert not t.is_alive(), "stop_capture() hung: capture process blocked on stderr"
    assert result["path"].endswith(".wav")


def test_linux_command_records_monitor_with_parec():
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.sys.platform", "linux"):
        cmd = AudioCaptureService()._build_command("x.monitor", "/tmp/out.wav")
    assert Path(cmd[0]).name == "parec"
    assert cmd[cmd.index("-d") + 1] == "x.monitor"
    assert "--file-format=wav" in cmd
    assert "--rate=48000" in cmd
    assert "--channels=2" in cmd
    # parec's default buffer is ~2 s; without a short latency the tail of the
    # recording is still buffered when SIGINT arrives and gets lost.
    assert any(a.startswith("--latency-msec=") for a in cmd)
    assert cmd[-1] == "/tmp/out.wav"
    assert "ffmpeg" not in " ".join(cmd)


def test_linux_command_defaults_to_default_monitor():
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.sys.platform", "linux"):
        cmd = AudioCaptureService()._build_command(None, "/tmp/out.wav")
    assert cmd[cmd.index("-d") + 1] == "@DEFAULT_MONITOR@"


def test_linux_start_without_parec_fails_with_package_hint(tmp_path):
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.shutil.which",
               side_effect=lambda name: None if name == "parec" else f"/usr/bin/{name}"), \
         patch("app.services.audio_capture_service.subprocess.Popen") as popen, \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture(source_id="x.monitor")
    assert "parec" in str(exc.value)
    assert "pulseaudio-utils" in str(exc.value)
    popen.assert_not_called()
    assert svc.has_active_jobs() is False


def _pactl_result(stdout: str):
    result = MagicMock()
    result.stdout = stdout
    result.returncode = 0
    return result


_DEFAULT_SOURCE = {"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}


def test_linux_sources_without_pactl_offer_default_monitor():
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.shutil.which",
               side_effect=lambda name: None if name == "pactl" else f"/usr/bin/{name}"), \
         patch("app.services.audio_capture_service.subprocess.run",
               side_effect=FileNotFoundError("pactl")), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        sources = AudioCaptureService().get_sources()
    assert sources == [_DEFAULT_SOURCE]


def test_linux_sources_when_pactl_fails_offer_default_monitor():
    AudioCaptureService = _get_service_class()
    with _with_pactl(), \
         patch("app.services.audio_capture_service.subprocess.run",
               side_effect=subprocess.TimeoutExpired("pactl", 5)), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        sources = AudioCaptureService().get_sources()
    assert sources == [_DEFAULT_SOURCE]


def test_linux_sources_without_monitors_offer_default_monitor():
    AudioCaptureService = _get_service_class()
    stdout = "1\talsa_input.usb-mic.analog-stereo\tPipeWire\ts16le 2ch 48000Hz\tSUSPENDED\n"
    with _with_pactl(), \
         patch("app.services.audio_capture_service.subprocess.run",
               return_value=_pactl_result(stdout)), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        sources = AudioCaptureService().get_sources()
    assert sources == [_DEFAULT_SOURCE]


def test_linux_sources_list_monitors_from_pactl():
    AudioCaptureService = _get_service_class()
    stdout = (
        "1\talsa_input.usb-mic.analog-stereo\tPipeWire\ts16le 2ch 48000Hz\tSUSPENDED\n"
        "2\talsa_output.pci-0000.hdmi-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n"
    )
    with _with_pactl(), \
         patch("app.services.audio_capture_service.subprocess.run",
               return_value=_pactl_result(stdout)), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        sources = AudioCaptureService().get_sources()
    assert sources == [{"id": "alsa_output.pci-0000.hdmi-stereo.monitor",
                        "label": "pci-0000.hdmi-stereo (Monitor)"}]


def test_linux_start_with_vanished_source_fails(tmp_path):
    """PipeWire silently records the default source when the requested one is
    gone (e.g. Bluetooth headphones switched off): refuse to start instead."""
    AudioCaptureService = _get_service_class()
    stdout = "2\talsa_output.pci-0000.hdmi-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n"
    with _with_pactl(), \
         patch("app.services.audio_capture_service.subprocess.run",
               return_value=_pactl_result(stdout)), \
         patch("app.services.audio_capture_service.subprocess.Popen") as popen, \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture(source_id="bluez_output.headphones.monitor")
    assert "bluez_output.headphones.monitor" in str(exc.value)
    assert "not available" in str(exc.value)
    popen.assert_not_called()


def test_linux_start_with_listed_or_default_source_is_allowed(tmp_path):
    AudioCaptureService = _get_service_class()
    stdout = "2\talsa_output.pci-0000.hdmi-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n"
    with _with_pactl(), \
         patch("app.services.audio_capture_service.subprocess.run",
               return_value=_pactl_result(stdout)), \
         patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=lambda *a, **k: _make_mock_popen()), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        svc.start_capture(source_id="alsa_output.pci-0000.hdmi-stereo.monitor")
        svc.start_capture(source_id="@DEFAULT_MONITOR@")
        svc.start_capture()


def test_linux_start_without_pactl_does_not_block_on_source_check(tmp_path):
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.subprocess.run",
               side_effect=FileNotFoundError("pactl")), \
         patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=lambda *a, **k: _make_mock_popen()), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        assert svc.start_capture(source_id="some.monitor")


def test_capture_process_exiting_at_start_fails_start(tmp_path):
    """A capture process that dies right away fails start_capture with its log,
    instead of the error surfacing only when the recording is stopped."""
    AudioCaptureService = _get_service_class()
    created = {}

    def _popen(cmd, stderr=None, **_kwargs):
        stderr.write(b"Stream error: No such entity\n")
        created["out"] = cmd[-1]
        return _make_mock_popen(alive=False)

    with patch("app.services.audio_capture_service.subprocess.Popen", side_effect=_popen), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture(source_id="gone.monitor")

    assert "No such entity" in str(exc.value)
    assert svc.has_active_jobs() is False
    assert list(tmp_path.glob("sonorus-sys-*")) == [], "log and output must be cleaned up"


def test_api_start_returns_400_when_capture_cannot_start(tmp_path):
    from app.api.dependencies import get_audio_capture_service
    AudioCaptureService = _get_service_class()
    svc = AudioCaptureService(recordings_dir=tmp_path)
    app.dependency_overrides[get_audio_capture_service] = lambda: svc
    try:
        with patch("app.services.audio_capture_service.shutil.which", return_value=None), \
             patch("app.services.audio_capture_service.sys.platform", "linux"):
            r = TestClient(app).post("/audio/capture/start", json={"source_id": "x.monitor"})
    finally:
        app.dependency_overrides.pop(get_audio_capture_service, None)
    assert r.status_code == 400
    assert "pulseaudio-utils" in r.json()["detail"]


def _stop_with_empty_output(platform: str, tmp_path, capture_bin=None) -> str:
    AudioCaptureService = _get_service_class()

    def _popen(cmd, **kwargs):
        proc = _make_mock_popen()
        if platform == "darwin":
            proc.stdout.readline.return_value = b"READY\n"
        return proc

    with patch("app.services.audio_capture_service.subprocess.Popen", side_effect=_popen), \
         patch("select.select", side_effect=lambda r, w, x, t: (r, [], [])), \
         patch("app.services.audio_capture_service.sys.platform", platform):
        svc = AudioCaptureService(capture_bin=capture_bin, recordings_dir=tmp_path)
        job_id = svc.start_capture()
        with pytest.raises(RuntimeError) as exc:
            svc.stop_capture(job_id)
    return str(exc.value)


def test_linux_empty_capture_error_does_not_mention_macos(tmp_path):
    msg = _stop_with_empty_output("linux", tmp_path)
    assert "No" in msg and "captured" in msg
    assert "Screen Recording" not in msg
    assert "System Settings" not in msg


def test_macos_empty_capture_error_mentions_screen_recording(tmp_path):
    msg = _stop_with_empty_output("darwin", tmp_path, capture_bin="/opt/sonorus-capture")
    assert "Screen Recording" in msg


def test_macos_driver_runs_capture_helper():
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.sys.platform", "darwin"):
        svc = AudioCaptureService(capture_bin="/opt/sonorus-capture")
        assert svc._build_command(None, "/tmp/out.wav") == ["/opt/sonorus-capture", "--output", "/tmp/out.wav"]
        assert svc.get_sources() == [{"id": "sckit", "label": "System audio (ScreenCaptureKit)"}]


def test_windows_has_no_backend_capture():
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.sys.platform", "win32"), \
         patch("app.services.audio_capture_service.subprocess.Popen") as popen:
        svc = AudioCaptureService()
        assert svc.get_sources() == []
        with pytest.raises(RuntimeError):
            svc.start_capture()
    popen.assert_not_called()


def test_capture_log_lines_do_not_name_the_macos_helper_on_linux(tmp_path, caplog):
    import logging
    # The app logger does not propagate to root, so listen on it directly.
    app_logger = logging.getLogger("app")
    app_logger.addHandler(caplog.handler)
    caplog.set_level(logging.INFO, logger="app")
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen([])), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        try:
            svc.stop_capture(svc.start_capture(source_id="x.monitor"))
        finally:
            app_logger.removeHandler(caplog.handler)
    assert caplog.records, "capture output should be logged"
    assert all("sonorus-capture" not in r.getMessage() for r in caplog.records)


# ── Recordings must be persisted outside the OS temp directory ────────────────

def _fake_capture_popen(output_holder):
    """Popen side effect that 'records' by writing a small WAV to the output path."""
    def _popen(cmd, **_kwargs):
        out = cmd[-1]
        with open(out, "wb") as f:
            f.write(b"RIFF" + b"\0" * 100)
        output_holder.append(out)
        return _make_mock_popen()
    return _popen


def _fake_merge_run(cmd, **_kwargs):
    with open(cmd[-1], "wb") as f:
        f.write(b"RIFF" + b"\0" * 200)


def test_system_only_recording_is_moved_to_recordings_dir(tmp_path):
    AudioCaptureService = _get_service_class()
    rec_dir = tmp_path / "recordings"
    svc = AudioCaptureService(recordings_dir=rec_dir)
    outputs = []
    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen(outputs)), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        job_id = svc.start_capture(source_id="x.monitor")
        final = svc.stop_capture(job_id)

    assert Path(final).parent == rec_dir
    assert Path(final).is_file()
    assert not Path(outputs[0]).exists(), "temp capture file must not be left behind"


def test_merged_recording_goes_to_recordings_dir_and_intermediates_removed(tmp_path):
    AudioCaptureService = _get_service_class()
    rec_dir = tmp_path / "recordings"
    rec_dir.mkdir()
    mic = rec_dir / "sonorus-rec-mic.webm"
    mic.write_bytes(b"webm")
    svc = AudioCaptureService(recordings_dir=rec_dir)
    outputs = []
    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen(outputs)), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_run), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        job_id = svc.start_capture(source_id="x.monitor")
        final = svc.stop_capture(job_id, mic_path=str(mic))

    assert Path(final).parent == rec_dir
    assert Path(final).is_file()
    assert not Path(outputs[0]).exists(), "system capture temp file must be removed"
    assert not mic.exists(), "mic recording inside recordings dir must be removed after merge"


def test_merge_never_deletes_mic_file_outside_recordings_dir(tmp_path):
    AudioCaptureService = _get_service_class()
    rec_dir = tmp_path / "recordings"
    mic = tmp_path / "user-file.webm"
    mic.write_bytes(b"webm")
    svc = AudioCaptureService(recordings_dir=rec_dir)
    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen([])), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_run), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        job_id = svc.start_capture(source_id="x.monitor")
        svc.stop_capture(job_id, mic_path=str(mic))

    assert mic.exists()


def test_has_active_jobs_tracks_running_capture(tmp_path):
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.subprocess.Popen", return_value=_make_mock_popen()):
        svc = AudioCaptureService(recordings_dir=tmp_path)
        assert svc.has_active_jobs() is False
        svc.start_capture()
        assert svc.has_active_jobs() is True
