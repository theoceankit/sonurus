"""GET/PUT /integrations/mcp: the switch of the MCP server, kept by the backend.
Settings → Data → Reset turns it off."""
from fastapi.testclient import TestClient

from app.api.dependencies import get_app_settings, get_live_recording_service
from app.api.main import app
from app.services.app_settings import AppSettings, MCP_ENABLED


def test_the_mcp_server_is_off_by_default():
    assert TestClient(app).get("/integrations/mcp").json() == {"enabled": False}


def test_put_turns_the_mcp_server_on_and_off():
    client = TestClient(app)
    settings = app.dependency_overrides[get_app_settings]()

    r = client.put("/integrations/mcp", json={"enabled": True})
    assert r.status_code == 200
    assert r.json() == {"enabled": True}
    assert client.get("/integrations/mcp").json() == {"enabled": True}
    assert AppSettings(settings.db_path).get_bool(MCP_ENABLED) is True

    assert client.put("/integrations/mcp", json={"enabled": False}).json() == {"enabled": False}
    assert client.get("/integrations/mcp").json() == {"enabled": False}


def test_put_needs_a_boolean():
    assert TestClient(app).put("/integrations/mcp", json={}).status_code == 422


class _Idle:
    def is_recording(self):
        return False


def test_data_reset_turns_the_mcp_server_off(tmp_path, monkeypatch):
    import app.config as config
    from app.api.dependencies import get_memory_service, get_storage_service
    from app.services.speaker_memory_service import SpeakerMemoryService
    from app.services.transcript_storage_service import TranscriptStorageService

    monkeypatch.setattr(config, "RECORDINGS_DIR", tmp_path / "recordings")
    monkeypatch.setattr(config, "SPEAKER_PHOTOS_DIR", tmp_path / "photos")
    storage = TranscriptStorageService(db_path=str(tmp_path / "data.db"))
    memory = SpeakerMemoryService(db_path=str(tmp_path / "data.db"))
    app.dependency_overrides[get_storage_service] = lambda: storage
    app.dependency_overrides[get_memory_service] = lambda: memory
    app.dependency_overrides[get_live_recording_service] = lambda: _Idle()
    try:
        client = TestClient(app)
        client.put("/integrations/mcp", json={"enabled": True})

        assert client.post("/data/reset").status_code == 200

        assert client.get("/integrations/mcp").json() == {"enabled": False}
    finally:
        for dep in (get_storage_service, get_memory_service, get_live_recording_service):
            app.dependency_overrides.pop(dep, None)
