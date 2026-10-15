"""
Tests for AudioCaptureService and /audio/capture/* FastAPI router.

Service tests mock subprocess.Popen so no real process is started.
API tests inject a stub AudioCaptureService via dependency_overrides.
"""
import shutil
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

    The capture output is levelled by one ffmpeg run (no merge) into the
    recordings dir.
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
    mock_run.assert_called_once()
    cmd = mock_run.call_args.args[0]
    assert "amix" not in " ".join(cmd)
    assert cmd[-1] == file_path
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


# ── Windows: WASAPI loopback helper (sonorus-capture.exe) ─────────────────────
#
# The helper is a real child process here (tests/capture_workers.py), so the
# handshake (READY on stdout, read without select()) and the stop through
# stdin (Windows has no SIGINT for a child) run on any OS.

_WORKER = Path(__file__).parent / "capture_workers.py"
_WIN_DEVICES = [
    {"id": "{0.0.0.00000000}.{speakers}", "label": "Speakers (Realtek)", "default": True},
    {"id": "{0.0.0.00000000}.{headphones}", "label": "Headphones (USB)", "default": False},
]


@pytest.fixture
def win_helper(tmp_path, monkeypatch):
    """An executable fake helper; FAKE_CAPTURE_DEVICES lists two outputs."""
    import json, sys
    if sys.platform == "win32":
        pytest.skip("the fake helper is a POSIX script")
    helper = tmp_path / "sonorus-capture.exe"
    helper.write_text(f"#!{sys.executable}\nimport runpy, sys\nsys.argv[0] = {str(_WORKER)!r}\n"
                      f"runpy.run_path({str(_WORKER)!r}, run_name='__main__')\n")
    helper.chmod(0o755)
    monkeypatch.setenv("FAKE_CAPTURE_DEVICES", json.dumps(_WIN_DEVICES))
    return str(helper)


_real_run = subprocess.run


def _fake_merge_or_list_run(cmd, **kwargs):
    """Fake ffmpeg runs, but let the helper's --list reach the real process."""
    if "--list" in cmd:
        return _real_run(cmd, **kwargs)
    return _fake_merge_run(cmd, **kwargs)


def _win_service(tmp_path, helper):
    AudioCaptureService = _get_service_class()
    return AudioCaptureService(capture_bin=helper, recordings_dir=tmp_path / "recordings")


def test_windows_sources_list_default_first_then_outputs_by_name(tmp_path, win_helper):
    with patch("app.services.audio_capture_service.sys.platform", "win32"):
        sources = _win_service(tmp_path, win_helper).get_sources()
    assert sources == [
        {"id": "default", "label": "System audio (default)"},
        {"id": "{0.0.0.00000000}.{headphones}", "label": "Headphones (USB)"},
        {"id": "{0.0.0.00000000}.{speakers}", "label": "Speakers (Realtek)"},
    ]


def test_windows_sources_empty_without_helper_or_when_listing_fails(tmp_path, win_helper, monkeypatch):
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.sys.platform", "win32"), \
         patch.object(AudioCaptureService, "_find_capture_bin", return_value=None):
        assert AudioCaptureService(recordings_dir=tmp_path).get_sources() == []
    monkeypatch.setenv("FAKE_CAPTURE_LIST_FAILS", "1")
    with patch("app.services.audio_capture_service.sys.platform", "win32"):
        assert _win_service(tmp_path, win_helper).get_sources() == []


def test_windows_command_runs_helper_with_device_and_output(tmp_path, win_helper):
    with patch("app.services.audio_capture_service.sys.platform", "win32"):
        svc = _win_service(tmp_path, win_helper)
        assert svc._build_command(None, "C:/t/out.wav") == [
            win_helper, "--device", "default", "--output", "C:/t/out.wav"]
        assert svc._build_command("{0.0.0.00000000}.{headphones}", "C:/t/out.wav")[2] == \
            "{0.0.0.00000000}.{headphones}"


def test_windows_start_without_helper_fails_with_build_hint(tmp_path):
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.sys.platform", "win32"), \
         patch.object(AudioCaptureService, "_find_capture_bin", return_value=None), \
         patch("app.services.audio_capture_service.subprocess.Popen") as popen:
        svc = AudioCaptureService(recordings_dir=tmp_path)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture()
    assert "build:capture:win" in str(exc.value)
    popen.assert_not_called()


def test_windows_start_without_output_devices_fails(tmp_path, win_helper, monkeypatch):
    monkeypatch.setenv("FAKE_CAPTURE_DEVICES", "[]")
    with patch("app.services.audio_capture_service.sys.platform", "win32"):
        svc = _win_service(tmp_path, win_helper)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture()
    assert "output device" in str(exc.value).lower()
    assert svc.has_active_jobs() is False


def test_windows_start_with_vanished_device_fails(tmp_path, win_helper):
    with patch("app.services.audio_capture_service.sys.platform", "win32"):
        svc = _win_service(tmp_path, win_helper)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture(source_id="{0.0.0.00000000}.{gone}")
    assert "not available" in str(exc.value)
    assert svc.has_active_jobs() is False


def test_windows_helper_failing_before_ready_fails_start(tmp_path, win_helper, monkeypatch):
    import json
    monkeypatch.setenv("FAKE_CAPTURE_DEVICES", json.dumps(
        _WIN_DEVICES + [{"id": "broken", "label": "Broken", "default": False}]))
    with patch("app.services.audio_capture_service.sys.platform", "win32"):
        svc = _win_service(tmp_path, win_helper)
        with pytest.raises(RuntimeError) as exc:
            svc.start_capture(source_id="broken")
    assert "could not open the output device" in str(exc.value)
    assert svc.has_active_jobs() is False


def test_windows_capture_stops_through_stdin_without_sigint(tmp_path, win_helper):
    with patch("app.services.audio_capture_service.sys.platform", "win32"), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_or_list_run):
        svc = _win_service(tmp_path, win_helper)
        job_id = svc.start_capture(source_id="{0.0.0.00000000}.{headphones}")
        process = svc._jobs[job_id].process
        with patch.object(process, "send_signal", wraps=process.send_signal) as send_signal:
            final = svc.stop_capture(job_id)
    send_signal.assert_not_called()
    assert process.returncode == 0, "the helper must exit on its own after 'stop'"
    assert Path(final).parent == tmp_path / "recordings" and Path(final).is_file()


def test_windows_capture_through_api_records_a_file(tmp_path, win_helper):
    from app.api.dependencies import get_audio_capture_service
    with patch("app.services.audio_capture_service.sys.platform", "win32"), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_or_list_run):
        svc = _win_service(tmp_path, win_helper)
        app.dependency_overrides[get_audio_capture_service] = lambda: svc
        try:
            client = TestClient(app)
            assert client.get("/audio/capture/sources").json()["sources"][0]["id"] == "default"
            job_id = client.post("/audio/capture/start", json={}).json()["job_id"]
            r = client.post(f"/audio/capture/stop/{job_id}", json={})
        finally:
            app.dependency_overrides.pop(get_audio_capture_service, None)
    assert r.status_code == 200, r.text
    assert Path(r.json()["file_path"]).is_file()


def test_macos_and_linux_still_stop_with_sigint(tmp_path):
    for platform, capture_bin in (("linux", None), ("darwin", "/opt/sonorus-capture")):
        procs = []
        def _popen(cmd, **kwargs):
            proc = _fake_capture_popen([])(cmd, **kwargs)
            proc.stdout.readline.return_value = b"READY\n"
            procs.append(proc)
            return proc
        AudioCaptureService = _get_service_class()
        with patch("app.services.audio_capture_service.subprocess.Popen", side_effect=_popen), \
             patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_run), \
             patch("app.services.audio_capture_service.sys.platform", platform):
            svc = AudioCaptureService(capture_bin=capture_bin, recordings_dir=tmp_path / platform)
            svc.stop_capture(svc.start_capture())
        import signal
        procs[0].send_signal.assert_called_once_with(signal.SIGINT)


def test_capture_bin_is_found_per_platform(tmp_path):
    AudioCaptureService = _get_service_class()
    root = tmp_path / "repo"
    (root / "electron" / "resources" / "mac").mkdir(parents=True)
    (root / "electron" / "resources" / "win").mkdir(parents=True)
    (root / "electron" / "resources" / "mac" / "sonorus-capture").write_text("")
    (root / "electron" / "resources" / "win" / "sonorus-capture.exe").write_text("")
    with patch("app.services.audio_capture_service._REPO_ROOT", root), \
         patch.dict("os.environ", {}, clear=False):
        import os
        os.environ.pop("SONORUS_CAPTURE_BIN", None)
        with patch("app.services.audio_capture_service.sys.platform", "win32"):
            assert AudioCaptureService()._capture_bin.endswith(os.path.join("win", "sonorus-capture.exe"))
        with patch("app.services.audio_capture_service.sys.platform", "darwin"):
            assert AudioCaptureService()._capture_bin.endswith(os.path.join("mac", "sonorus-capture"))


def test_capture_log_lines_do_not_name_the_macos_helper_on_linux(tmp_path, caplog):
    import logging
    # The app logger does not propagate to root, so listen on it directly.
    app_logger = logging.getLogger("app")
    app_logger.addHandler(caplog.handler)
    caplog.set_level(logging.INFO, logger="app")
    AudioCaptureService = _get_service_class()
    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen([])), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_run), \
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
         patch("app.services.audio_capture_service.subprocess.run", side_effect=_fake_merge_run), \
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


# ── Loudness levelling ────────────────────────────────────────────────────────
#
# A quiet system track next to a loud mic used to vanish from the transcript:
# every track that holds system audio is levelled (dynaudnorm) before it is
# stored, the mix does not divide by the number of inputs, a limiter keeps it
# from clipping. A failed levelling run falls back to the old behaviour.

def _stop_capture(tmp_path, run, mic_path=None):
    AudioCaptureService = _get_service_class()
    rec_dir = tmp_path / "recordings"
    svc = AudioCaptureService(recordings_dir=rec_dir)
    outputs = []
    with patch("app.services.audio_capture_service.subprocess.Popen",
               side_effect=_fake_capture_popen(outputs)), \
         patch("app.services.audio_capture_service.subprocess.run", side_effect=run), \
         patch("app.services.audio_capture_service.sys.platform", "linux"):
        job_id = svc.start_capture(source_id="x.monitor")
        final = svc.stop_capture(job_id, mic_path=mic_path)
    return final, outputs[0], rec_dir


def _recording_run(calls, fail_first: int = 0, error=None):
    """subprocess.run stand-in: records commands; the first `fail_first` calls raise."""
    def _run(cmd, **kwargs):
        calls.append(cmd)
        if len(calls) <= fail_first:
            raise error or subprocess.CalledProcessError(1, cmd)
        _fake_merge_run(cmd, **kwargs)
    return _run


@pytest.fixture
def app_warnings(caplog):
    """caplog on the app logger (it does not propagate to root)."""
    import logging
    app_logger = logging.getLogger("app")
    app_logger.addHandler(caplog.handler)
    caplog.set_level(logging.WARNING, logger="app")
    yield lambda: [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    app_logger.removeHandler(caplog.handler)


def _filter_arg(cmd) -> str:
    for flag in ("-filter_complex", "-af"):
        if flag in cmd:
            return cmd[cmd.index(flag) + 1]
    return ""


def test_mix_levels_each_track_and_limits_without_dividing(tmp_path):
    calls = []
    mic = tmp_path / "mic.webm"
    mic.write_bytes(b"webm")
    final, _, rec_dir = _stop_capture(tmp_path, _recording_run(calls), mic_path=str(mic))

    assert len(calls) == 1
    graph = _filter_arg(calls[0])
    assert graph.count("dynaudnorm") == 2, "both tracks are levelled before the mix"
    assert "amix=inputs=2" in graph
    assert "duration=shortest" in graph
    assert "normalize=0" in graph, "the mix must not divide the volume by the number of inputs"
    assert "alimiter" in graph
    assert graph.index("dynaudnorm") < graph.index("amix") < graph.index("alimiter")
    assert calls[0][-1] == final
    assert Path(final).parent == rec_dir
    assert Path(final).name.startswith("sonorus-rec-") and final.endswith(".wav")


def test_system_only_recording_is_levelled_into_recordings_dir(tmp_path):
    calls = []
    final, capture_tmp, rec_dir = _stop_capture(tmp_path, _recording_run(calls))

    assert len(calls) == 1
    cmd = calls[0]
    assert "dynaudnorm" in _filter_arg(cmd)
    assert "amix" not in " ".join(cmd)
    assert cmd[cmd.index("-i") + 1] == capture_tmp
    assert cmd[-1] == final
    assert Path(final).parent == rec_dir and Path(final).is_file()
    assert not Path(capture_tmp).exists(), "temp capture file must not be left behind"


def test_mix_falls_back_to_plain_amix_when_levelling_fails(tmp_path, app_warnings):
    calls = []
    mic = tmp_path / "recordings-mic.webm"
    mic.write_bytes(b"webm")
    final, capture_tmp, _ = _stop_capture(
        tmp_path, _recording_run(calls, fail_first=1), mic_path=str(mic))

    assert len(calls) == 2
    fallback = _filter_arg(calls[1])
    assert "amix=inputs=2:duration=shortest" in fallback
    assert "dynaudnorm" not in fallback
    assert Path(final).is_file()
    assert not Path(capture_tmp).exists()
    assert any("level" in m.lower() for m in app_warnings())


def test_mix_raises_when_fallback_mix_fails_too(tmp_path):
    calls = []
    mic = tmp_path / "mic.webm"
    mic.write_bytes(b"webm")
    with pytest.raises(subprocess.CalledProcessError):
        _stop_capture(tmp_path, _recording_run(calls, fail_first=2), mic_path=str(mic))


@pytest.mark.parametrize("error", [
    subprocess.CalledProcessError(1, "ffmpeg"),
    FileNotFoundError("ffmpeg"),
])
def test_system_only_recording_is_kept_as_is_when_levelling_fails(tmp_path, app_warnings, error):
    calls = []
    final, capture_tmp, rec_dir = _stop_capture(
        tmp_path, _recording_run(calls, fail_first=1, error=error))

    assert len(calls) == 1
    assert Path(final).parent == rec_dir and Path(final).is_file()
    assert Path(final).read_bytes().startswith(b"RIFF")
    assert not Path(capture_tmp).exists()
    assert any("level" in m.lower() for m in app_warnings())


# Real ffmpeg: the filter values are what matters here, so run them on
# generated signals (speech-like: 1 s tone, 0.5 s pause) and measure.

_FFMPEG = shutil.which("ffmpeg")


def _ffmpeg_gen(path, source: str, channels: int = 2):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", source,
         "-ar", "48000", "-ac", str(channels), str(path)],
        check=True,
    )


def _speech_like(path, gain_db: float, freq: int = 440, channels: int = 2, seconds: int = 12):
    gate = "volume='if(lt(mod(t,1.5),1),1,0)':eval=frame"
    _ffmpeg_gen(path, f"sine=f={freq}:d={seconds},volume={gain_db}dB,{gate}", channels)


def _levels_db(path) -> tuple[float, float]:
    """(RMS, peak) of a 16-bit WAV in dBFS."""
    import array, math, wave
    with wave.open(str(path)) as w:
        assert w.getsampwidth() == 2
        samples = array.array("h", w.readframes(w.getnframes()))
    if not samples:
        return float("-inf"), float("-inf")
    rms = math.sqrt(sum(s * s for s in samples) / len(samples)) / 32768
    peak = max(abs(s) for s in samples) / 32768
    to_db = lambda v: 20 * math.log10(v) if v > 0 else float("-inf")
    return to_db(rms), to_db(peak)


def _copy_capture_popen(source):
    """Popen stand-in whose 'recording' is a copy of `source`."""
    def _popen(cmd, **_kwargs):
        Path(cmd[-1]).write_bytes(Path(source).read_bytes())
        return _make_mock_popen()
    return _popen


def _real_stop(tmp_path, system_source, mic_path=None) -> str:
    AudioCaptureService = _get_service_class()
    svc = AudioCaptureService(recordings_dir=tmp_path / "recordings")
    with patch("app.services.audio_capture_service.sys.platform", "linux"):
        # Only start_capture gets the fake process: the levelling ffmpeg run in
        # stop_capture goes through subprocess.Popen too and must be real.
        with patch("app.services.audio_capture_service.subprocess.Popen",
                   side_effect=_copy_capture_popen(system_source)):
            job_id = svc.start_capture(source_id="x.monitor")
        return svc.stop_capture(job_id, mic_path=mic_path)


needs_ffmpeg = pytest.mark.skipif(_FFMPEG is None, reason="ffmpeg not installed")


@needs_ffmpeg
def test_real_ffmpeg_quiet_and_loud_tracks_end_up_close(tmp_path):
    quiet, loud = tmp_path / "quiet.wav", tmp_path / "loud.wav"
    _speech_like(quiet, -24)   # ≈ −50 dBFS RMS
    _speech_like(loud, -4)     # ≈ −27 dBFS RMS
    gap_before = _levels_db(loud)[0] - _levels_db(quiet)[0]
    assert gap_before > 18

    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    quiet_rms = _levels_db(_real_stop(tmp_path / "a", quiet))[0]
    loud_rms = _levels_db(_real_stop(tmp_path / "b", loud))[0]
    assert abs(loud_rms - quiet_rms) <= 6, (quiet_rms, loud_rms)


@needs_ffmpeg
def test_real_ffmpeg_compressed_and_peaky_tracks_match_in_loudness(tmp_path):
    """Equal peaks are not equal loudness: compressed call audio (low crest
    factor) must not end up louder than a peaky mic voice."""
    gate = "volume='if(lt(mod(t,1.5),1),1,0)':eval=frame"
    compressed, peaky = tmp_path / "compressed.wav", tmp_path / "peaky.wav"
    _ffmpeg_gen(compressed, f"sine=f=440:d=12,volume=-20dB,{gate}", 1)
    _ffmpeg_gen(peaky, f"anoisesrc=d=12:a=0.05:c=white,lowpass=f=3000,{gate}", 1)

    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    compressed_rms = _levels_db(_real_stop(tmp_path / "a", compressed))[0]
    peaky_rms = _levels_db(_real_stop(tmp_path / "b", peaky))[0]
    assert abs(compressed_rms - peaky_rms) <= 2, (compressed_rms, peaky_rms)


@needs_ffmpeg
@pytest.mark.parametrize("source", [
    "anullsrc=r=48000:cl=stereo:d=8",          # digital silence (nothing playing)
    "anoisesrc=d=8:a=0.001:c=pink",            # faint background noise, ≈ −77 dBFS
])
def test_real_ffmpeg_silence_and_noise_are_not_boosted(tmp_path, source):
    src = tmp_path / "src.wav"
    _ffmpeg_gen(src, source)
    rms, peak = _levels_db(_real_stop(tmp_path, src))
    assert rms < -60 and peak < -55, (rms, peak)


@needs_ffmpeg
def test_real_ffmpeg_mix_of_two_loud_tracks_does_not_clip(tmp_path):
    system, mic = tmp_path / "system.wav", tmp_path / "mic.wav"
    _speech_like(system, 0, freq=440)
    _speech_like(mic, 0, freq=300, channels=1)
    final = _real_stop(tmp_path, system, mic_path=str(mic))
    rms, peak = _levels_db(final)
    assert peak <= -0.3, peak
    assert rms > -30, rms
