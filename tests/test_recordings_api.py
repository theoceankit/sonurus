"""POST /audio/recordings — the renderer uploads a live recording and the
backend stores it in its own RECORDINGS_DIR (the only place that writes
there), so the recording never depends on where Electron keeps its data."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.config as config
from app.api.main import app


@pytest.fixture
def recordings(tmp_path, monkeypatch):
    d = tmp_path / "data" / "recordings"
    monkeypatch.setattr(config, "RECORDINGS_DIR", d)
    return d


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.parametrize("content_type, ext", [
    ("audio/webm;codecs=opus", ".webm"),
    ("audio/webm", ".webm"),
    ("audio/wav", ".wav"),
    ("audio/x-wav", ".wav"),
])
def test_upload_stores_recording_in_backend_recordings_dir(client, recordings, content_type, ext):
    r = client.post("/audio/recordings", content=b"recorded-audio",
                    headers={"Content-Type": content_type})
    assert r.status_code == 201, r.text
    path = Path(r.json()["file_path"])
    assert path.parent == recordings
    assert path.name.startswith("sonorus-rec-") and path.suffix == ext
    assert path.read_bytes() == b"recorded-audio"


def test_upload_rejects_unsupported_type(client, recordings):
    r = client.post("/audio/recordings", content=b"x",
                    headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 415
    assert not recordings.exists() or not any(recordings.iterdir())


def test_upload_rejects_empty_recording(client, recordings):
    r = client.post("/audio/recordings", content=b"", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 400
    assert not recordings.exists() or not any(recordings.iterdir())
