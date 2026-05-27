"""
Tests for the "cancel download" feature in ModelService and the models router.

Covers:
  - ModelService.download_model() cancel_event kwarg (threading.Event)
  - CancelledError raised when event is set before or during download
  - DELETE /models/{model_id}/download/{job_id} → 200 for active job, 404 for finished/unknown
  - DELETE /models/{model_id}/download/{job_id} → 422 for invalid model_id
  - WebSocket sends {"type": "cancelled"} and closes cleanly after cancellation
"""
import threading
import time
import uuid
from asyncio import CancelledError
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.api.dependencies import get_memory_service, get_storage_service
from app.services.model_service import ModelService, WHISPER_CATALOG
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.speaker_memory_service import SpeakerMemoryService


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def make_service(tmp_path: Path) -> ModelService:
    """Return a ModelService pointed at a temporary directory."""
    models_dir = tmp_path / "whisper"
    return ModelService(models_dir)


@pytest.fixture
def client(tmp_path):
    """TestClient with overridden DB dependencies; MODELS_DIR patched to tmp_path."""
    transcript_db = str(tmp_path / "transcripts.db")
    memory_db = str(tmp_path / "memory.db")

    def _storage():
        return TranscriptStorageService(db_path=transcript_db)

    def _memory():
        return SpeakerMemoryService(db_path=memory_db)

    app.dependency_overrides[get_storage_service] = _storage
    app.dependency_overrides[get_memory_service] = _memory

    import app.config as config
    original_whisper = config.WHISPER_MODELS_DIR
    original_hf = config.HF_MODELS_DIR
    original_alignment = config.ALIGNMENT_MODELS_DIR
    config.WHISPER_MODELS_DIR = tmp_path
    config.HF_MODELS_DIR = tmp_path / "hf"
    config.ALIGNMENT_MODELS_DIR = tmp_path / "alignment"

    yield TestClient(app)

    config.WHISPER_MODELS_DIR = original_whisper
    config.HF_MODELS_DIR = original_hf
    config.ALIGNMENT_MODELS_DIR = original_alignment
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# ModelService — cancel_event parameter
# ---------------------------------------------------------------------------

def test_download_model_raises_cancelled_error_when_event_pre_set(tmp_path):
    """download_model() raises CancelledError immediately when cancel_event is
    already set before the call is made (cancelled before any bytes transfer)."""
    svc = make_service(tmp_path)
    cancel_event = threading.Event()
    cancel_event.set()

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download"
    ) as mock_dl:
        # Even if snapshot_download were to succeed, CancelledError should fire first.
        mock_dl.return_value = str(tmp_path / "fake_cache")

        with pytest.raises(CancelledError):
            svc.download_model("small", cancel_event=cancel_event)


def test_download_model_raises_cancelled_error_mid_download(tmp_path):
    """download_model() raises CancelledError when cancel_event is set during
    a simulated slow download (mid-flight cancellation)."""
    svc = make_service(tmp_path)
    cancel_event = threading.Event()

    def slow_download(*args, **kwargs):
        """Simulate a download that takes time; set cancel mid-way."""
        on_progress = kwargs.get("tqdm_class") or kwargs.get("on_progress")
        # Allow the call to start, then set the event to simulate cancellation.
        cancel_event.set()
        # Block briefly to give the service a chance to check the event.
        time.sleep(0.05)
        return str(tmp_path / "fake_cache")

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download",
        side_effect=slow_download,
    ):
        with pytest.raises(CancelledError):
            svc.download_model("small", cancel_event=cancel_event)


def test_download_model_accepts_none_cancel_event(tmp_path):
    """download_model() accepts cancel_event=None explicitly and completes normally.

    This requires the new kwarg signature to exist. Currently fails because
    the kwarg is not yet accepted by the implementation.
    """
    svc = make_service(tmp_path)

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download"
    ) as mock_dl:
        mock_dl.return_value = str(tmp_path / "fake_cache")
        # Passing cancel_event=None explicitly must be valid — the new signature
        # must default to None and treat it as "no cancellation".
        svc.download_model("small", cancel_event=None)


def test_download_model_completes_normally_with_unset_cancel_event(tmp_path):
    """download_model() completes normally when cancel_event is provided but not set."""
    svc = make_service(tmp_path)
    cancel_event = threading.Event()  # not set

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download"
    ) as mock_dl:
        mock_dl.return_value = str(tmp_path / "fake_cache")
        # Should not raise.
        svc.download_model("small", cancel_event=cancel_event)


# ---------------------------------------------------------------------------
# DELETE /models/{model_id}/download/{job_id}
# ---------------------------------------------------------------------------

def test_cancel_download_returns_200_for_known_job(client):
    """DELETE /models/{model_id}/download/{job_id} returns 200 and
    {"cancelled": job_id} for a job that was started and is still running."""
    # Patch snapshot_download so the background thread blocks until we cancel.
    barrier = threading.Barrier(2, timeout=5)
    download_started = threading.Event()

    def blocking_download(*args, **kwargs):
        download_started.set()
        barrier.wait()  # released when the test calls DELETE
        return str(client.app.state)  # value doesn't matter — will be cancelled

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download",
        side_effect=blocking_download,
    ):
        # Start a download job.
        post_r = client.post("/models/small/download")
        assert post_r.status_code == 200, (
            f"POST /models/small/download must return 200; got {post_r.status_code}"
        )
        job_id = post_r.json()["job_id"]

        # Wait until the background download has actually started.
        download_started.wait(timeout=5)

        # Cancel it.
        del_r = client.delete(f"/models/small/download/{job_id}")

        # Release the blocking download so the thread can finish.
        try:
            barrier.wait(timeout=1)
        except threading.BrokenBarrierError:
            pass  # cancel may have interrupted before barrier wait

    assert del_r.status_code == 200, (
        f"Expected 200 from cancel endpoint, got {del_r.status_code}: {del_r.text}"
    )
    body = del_r.json()
    assert body == {"cancelled": job_id}, (
        f"Expected {{'cancelled': {job_id!r}}}, got {body}"
    )


def test_cancel_download_returns_404_for_unknown_job_id(client):
    """DELETE /models/{model_id}/download/{job_id} returns 404 when the
    job_id has never existed or has already finished.

    This test also verifies the route is actually registered: it checks that
    the 404 body does NOT contain FastAPI's generic 'Not Found' detail, which
    would indicate the route itself is missing rather than the job being unknown.
    """
    fake_job_id = str(uuid.uuid4())
    r = client.delete(f"/models/small/download/{fake_job_id}")
    assert r.status_code == 404, (
        f"Expected 404 for unknown job_id, got {r.status_code}: {r.text}"
    )
    # FastAPI's generic route-not-found returns {"detail": "Not Found"}.
    # The implementation must return a more specific message (not generic).
    body = r.json()
    assert body.get("detail") != "Not Found", (
        "The route is not registered yet — FastAPI returned its generic 'Not Found'. "
        "This 404 is not from the cancel logic but from routing."
    )


def test_cancel_download_returns_422_for_invalid_model_id(client):
    """DELETE /models/{model_id}/download/{job_id} returns 422 when model_id
    is not a valid catalog ID."""
    fake_job_id = str(uuid.uuid4())
    r = client.delete(f"/models/not-a-real-model/download/{fake_job_id}")
    assert r.status_code == 422, (
        f"Expected 422 for invalid model_id, got {r.status_code}: {r.text}"
    )


def test_cancel_download_after_job_finishes_returns_404(client):
    """DELETE /models/{model_id}/download/{job_id} returns 404 when the job
    has already completed (job entry cleaned up after finish).

    The route must be registered for this test to be meaningful — the 404
    must come from the cancel logic, not from FastAPI's route resolver.
    """
    # Both snapshot_download AND model_info must be patched and kept active
    # while the background thread runs.  model_info is called by _get_total_bytes
    # before snapshot_download starts; without the patch it makes a real network
    # call that outlasts the 0.3 s sleep and causes a false 200.
    with patch("app.services.model_service.huggingface_hub.snapshot_download") as mock_dl, \
         patch("app.services.model_service.huggingface_hub.model_info") as mock_info:
        mock_dl.return_value = "/tmp/fake_cache"
        mock_info.return_value = MagicMock(siblings=[])

        post_r = client.post("/models/tiny/download")
        assert post_r.status_code == 200
        job_id = post_r.json()["job_id"]

        # Sleep inside the with-block so both patches stay active while the
        # background thread (download + poller) finishes.
        time.sleep(0.5)

    r = client.delete(f"/models/tiny/download/{job_id}")
    assert r.status_code == 404, (
        f"Expected 404 for completed job, got {r.status_code}: {r.text}"
    )
    # Confirm this is an application-level 404, not a routing 404.
    body = r.json()
    assert body.get("detail") != "Not Found", (
        "The cancel route is not registered — FastAPI returned its generic 'Not Found'. "
        "The 404 must come from the cancel logic, not from missing route."
    )


# ---------------------------------------------------------------------------
# WebSocket — cancelled event
# ---------------------------------------------------------------------------

def test_ws_receives_cancelled_event_after_cancel_endpoint(client):
    """After DELETE /models/{model_id}/download/{job_id} is called, the WS
    stream sends {"type": "cancelled"} and then closes cleanly."""
    download_started = threading.Event()
    cancel_issued = threading.Event()

    def blocking_download(*args, **kwargs):
        download_started.set()
        # Block until the test issues the cancel request.
        cancel_issued.wait(timeout=5)
        time.sleep(0.05)
        return "/fake"

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download",
        side_effect=blocking_download,
    ):
        post_r = client.post("/models/base/download")
        assert post_r.status_code == 200
        job_id = post_r.json()["job_id"]

        received_events = []

        # Open WS and collect events in background.
        def collect_ws():
            with client.websocket_connect(f"/ws/models/{job_id}") as ws:
                try:
                    while True:
                        msg = ws.receive_json()
                        received_events.append(msg)
                        if msg.get("type") in ("cancelled", "error", "done"):
                            break
                except Exception:
                    pass  # WS closed by server

        ws_thread = threading.Thread(target=collect_ws, daemon=True)
        ws_thread.start()

        # Wait for download to start, then cancel.
        download_started.wait(timeout=5)
        del_r = client.delete(f"/models/base/download/{job_id}")
        cancel_issued.set()

        ws_thread.join(timeout=5)

    assert del_r.status_code == 200, (
        f"Cancel endpoint returned {del_r.status_code}: {del_r.text}"
    )

    event_types = [e.get("type") for e in received_events]
    assert "cancelled" in event_types, (
        f"Expected a {{'type': 'cancelled'}} event in WS stream; got: {received_events}"
    )

    # The stream must NOT contain an error event — it should close cleanly.
    assert "error" not in event_types, (
        f"WS stream must close cleanly after cancel (no error event); got: {received_events}"
    )


def test_ws_cancelled_event_is_final_message(client):
    """The {"type": "cancelled"} message is the last message on the WS stream
    — no further progress or error events follow it."""
    download_started = threading.Event()

    def blocking_download(*args, **kwargs):
        download_started.set()
        time.sleep(2)  # hold download open long enough to cancel
        return "/fake"

    with patch(
        "app.services.model_service.huggingface_hub.snapshot_download",
        side_effect=blocking_download,
    ):
        post_r = client.post("/models/medium/download")
        assert post_r.status_code == 200
        job_id = post_r.json()["job_id"]

        all_events = []

        def collect_ws():
            with client.websocket_connect(f"/ws/models/{job_id}") as ws:
                try:
                    while True:
                        msg = ws.receive_json()
                        all_events.append(msg)
                        if msg.get("type") in ("cancelled", "error", "done"):
                            # Attempt to read one more message to check nothing follows.
                            try:
                                extra = ws.receive_json()
                                all_events.append(("EXTRA", extra))
                            except Exception:
                                pass  # expected — WS should be closed
                            break
                except Exception:
                    pass

        ws_thread = threading.Thread(target=collect_ws, daemon=True)
        ws_thread.start()

        download_started.wait(timeout=5)
        client.delete(f"/models/medium/download/{job_id}")

        ws_thread.join(timeout=5)

    # Verify the "cancelled" event is present.
    event_types = [e.get("type") if isinstance(e, dict) else e[0] for e in all_events]
    assert "cancelled" in event_types, (
        f"Expected 'cancelled' in WS events; got: {all_events}"
    )

    # Nothing labelled EXTRA should appear after cancelled.
    assert "EXTRA" not in event_types, (
        f"Messages followed the 'cancelled' event — stream did not close cleanly: {all_events}"
    )
