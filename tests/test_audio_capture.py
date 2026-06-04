"""
Tests for AudioCaptureService and /audio/capture/* FastAPI router.

Service tests mock subprocess.Popen so no real process is started.
API tests inject a stub AudioCaptureService via dependency_overrides.
"""
import uuid as uuid_module
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


def _make_mock_popen():
    """Return a mock Popen instance with send_signal() and wait()."""
    proc = MagicMock()
    proc.send_signal = MagicMock()
    proc.wait = MagicMock(return_value=0)
    return proc


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


def test_stop_capture_without_mic_returns_system_file():
    """stop_capture(job_id) without mic_path returns the system audio file path.

    No ffmpeg merge should be performed; the returned path is the raw
    capture output file.
    """
    AudioCaptureService = _get_service_class()

    mock_proc = _make_mock_popen()
    with patch("app.services.audio_capture_service.subprocess.Popen", return_value=mock_proc):
        svc = AudioCaptureService()
        job_id = svc.start_capture()
        file_path = svc.stop_capture(job_id)

    assert isinstance(file_path, str), "stop_capture must return a string path"
    assert len(file_path) > 0, "returned path must not be empty"
    # SIGINT (or equivalent) must have been sent to the subprocess
    mock_proc.send_signal.assert_called_once()
    mock_proc.wait.assert_called_once()


def test_stop_capture_with_mic_path_returns_merged_file():
    """stop_capture(job_id, mic_path=...) returns a different (merged) file path.

    When mic_path is provided, the service should merge system + mic audio
    and return a merged output path that differs from the system-only path.
    """
    AudioCaptureService = _get_service_class()

    mock_proc_sys = _make_mock_popen()
    mock_proc_mic = _make_mock_popen()

    with patch(
        "app.services.audio_capture_service.subprocess.Popen",
        side_effect=[mock_proc_sys, mock_proc_mic],
    ):
        svc = AudioCaptureService()
        jid_sys = svc.start_capture()
        jid_mic = svc.start_capture()

        with patch("app.services.audio_capture_service.subprocess.run", return_value=None):
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
