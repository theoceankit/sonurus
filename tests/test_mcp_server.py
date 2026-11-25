"""The MCP server at /mcp (app/mcp/): answered only while switched on, guarded
against other sites (Origin) and other host names (Host), and its tools called
by the SDK's own client against a temporary database."""
import socket

import httpx2
import pytest
from fastapi.testclient import TestClient
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.api.dependencies import get_app_settings, get_storage_service
from app.api.main import app, mcp_endpoint
from app.mcp.tools import clock, format_recordings
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.app_settings import MCP_ENABLED
from app.services.transcript_storage_service import TranscriptStorageService

URL = "http://127.0.0.1:8000/mcp"
INITIALIZE = {
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {},
               "clientInfo": {"name": "test", "version": "0"}},
}
HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture
def storage(tmp_path):
    storage = TranscriptStorageService(db_path=str(tmp_path / "data.db"))
    app.dependency_overrides[get_storage_service] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage_service, None)


def _switch(on: bool):
    app.dependency_overrides[get_app_settings]().set_bool(MCP_ENABLED, on)


def _save(storage, title, end, created_at):
    transcript = Transcript(
        audio_path=f"recordings/{title}.wav", language="en",
        segments=[Segment(0.0, end, "Hello", "SPEAKER_00")],
    )
    db_id = storage.save(transcript)
    storage.update_title(db_id, title)
    with storage._connect() as conn:
        conn.execute("UPDATE transcriptions SET created_at = ? WHERE id = ?", (created_at, db_id))
    return db_id


class _MicIdle:
    def start(self):
        pass

    def stop(self):
        pass


def _http_client():
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://127.0.0.1:8000")


# ── Formatting ────────────────────────────────────────────────────────────────

def test_clock_is_minutes_and_seconds_under_an_hour_and_hours_after():
    assert clock(0) == "00:00"
    assert clock(75.9) == "01:15"
    assert clock(3599) == "59:59"
    assert clock(3600) == "1:00:00"
    assert clock(4 * 3600 + 5 * 60 + 6) == "4:05:06"


def test_recordings_are_listed_one_per_line_with_their_id():
    rows = [
        {"id": 7, "title": "Weekly sync", "created_at": "2026-11-20T10:03:00", "duration_sec": 2712.4},
        {"id": 3, "title": "Interview", "created_at": "2026-11-02T18:00:00", "duration_sec": 3725},
    ]
    assert format_recordings(rows) == (
        "2 recordings, newest first:\n"
        "- recording_id 7: Weekly sync, 2026-11-20, 45:12\n"
        "- recording_id 3: Interview, 2026-11-02, 1:02:05"
    )


def test_no_recordings_says_how_to_get_one():
    assert format_recordings([]) == "No recordings yet. Transcribe or record audio in Sonorus first."


# ── The switch ────────────────────────────────────────────────────────────────

def test_mcp_is_not_found_while_switched_off():
    client = TestClient(app, base_url="http://127.0.0.1:8000")
    r = client.post("/mcp", json=INITIALIZE, headers=HEADERS)
    assert r.status_code == 404
    assert client.get("/mcp").status_code == 404


@pytest.mark.anyio
async def test_switching_takes_effect_without_a_restart(storage):
    async with mcp_endpoint.running(), _http_client() as http:
        assert (await http.post("/mcp", json=INITIALIZE, headers=HEADERS)).status_code == 404
        _switch(True)
        on = await http.post("/mcp", json=INITIALIZE, headers=HEADERS)
        assert on.status_code == 200
        assert on.json()["result"]["serverInfo"]["name"] == "Sonorus"
        _switch(False)
        assert (await http.post("/mcp", json=INITIALIZE, headers=HEADERS)).status_code == 404


def test_the_app_lifespan_runs_the_server(storage, tmp_path, monkeypatch):
    # The lifespan touches the data dir: everything it reaches is temporary.
    import app.api.main as main_module
    import app.config as config
    from app.api.dependencies import get_transcription_queue
    from app.services.speaker_memory_service import SpeakerMemoryService

    class _Idle:
        def shutdown(self):
            pass

    monkeypatch.setattr(config, "RECORDINGS_DIR", tmp_path / "recordings")
    monkeypatch.setattr(config, "SPEAKER_PHOTOS_DIR", tmp_path / "photos")
    monkeypatch.setattr(config, "MIC_WATCH", False)
    monkeypatch.setattr(main_module, "get_storage_service", lambda: storage)
    monkeypatch.setattr(main_module, "get_memory_service",
                        lambda: SpeakerMemoryService(db_path=str(tmp_path / "memory.db")))
    monkeypatch.setattr(main_module, "get_transcription_queue", app.dependency_overrides[get_transcription_queue])
    monkeypatch.setattr(main_module, "get_mic_activity_service", lambda: _MicIdle())
    monkeypatch.setattr(main_module, "get_live_recording_service", lambda: _Idle())
    monkeypatch.setattr(main_module.models, "shutdown_executor", lambda: None)
    _switch(True)
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        r = client.post("/mcp", json=INITIALIZE, headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["result"]["serverInfo"]["name"] == "Sonorus"


def test_mcp_is_not_in_the_rest_api_schema():
    assert not any(path.startswith("/mcp") for path in app.openapi()["paths"])


# ── Other sites and host names ────────────────────────────────────────────────

@pytest.mark.anyio
async def test_a_page_of_another_site_is_refused():
    _switch(True)
    async with mcp_endpoint.running(), _http_client() as http:
        r = await http.post("/mcp", json=INITIALIZE, headers={**HEADERS, "Origin": "http://evil.example"})
    assert r.status_code == 403


@pytest.mark.anyio
async def test_another_host_name_is_refused():
    _switch(True)
    async with mcp_endpoint.running(), _http_client() as http:
        r = await http.post("/mcp", json=INITIALIZE, headers={**HEADERS, "Host": "evil.example"})
    assert r.status_code == 421


@pytest.mark.anyio
async def test_a_local_page_and_localhost_are_let_in():
    _switch(True)
    async with mcp_endpoint.running(), httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://localhost:8000",
    ) as http:
        r = await http.post("/mcp", json=INITIALIZE, headers={**HEADERS, "Origin": "http://localhost:8000"})
    assert r.status_code == 200


# ── Tools, through the SDK's client ───────────────────────────────────────────

@pytest.fixture
def no_network(monkeypatch):
    """Fails on any connection that leaves the machine."""
    real_connect = socket.socket.connect
    attempts = []

    def connect(sock, address):
        host = address[0] if isinstance(address, tuple) else address
        if host not in ("127.0.0.1", "::1", "localhost") and not str(host).startswith("/"):
            attempts.append(address)
            raise OSError(f"network blocked in tests: {address}")
        return real_connect(sock, address)

    monkeypatch.setattr(socket.socket, "connect", connect)
    return attempts


@pytest.mark.anyio
async def test_the_sdk_client_lists_and_calls_the_tools(storage, no_network):
    _save(storage, "Interview", 3725.0, "2026-11-02T18:00:00")
    _save(storage, "Weekly sync", 2712.4, "2026-11-20T10:03:00")
    _switch(True)

    async with mcp_endpoint.running(), _http_client() as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            tools = (await client.list_tools()).tools
            result = await client.call_tool("list_recordings", {})

    listed = next(tool for tool in tools if tool.name == "list_recordings")
    assert listed.description
    assert not result.is_error
    text = result.content[0].text
    lines = text.splitlines()
    assert lines[0] == "2 recordings, newest first:"
    assert lines[1].endswith(": Weekly sync, 2026-11-20, 45:12")
    assert lines[2].endswith(": Interview, 2026-11-02, 1:02:05")
    assert no_network == []


@pytest.mark.anyio
async def test_list_recordings_on_an_empty_database(storage):
    _switch(True)
    async with mcp_endpoint.running(), _http_client() as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            result = await client.call_tool("list_recordings", {})
    assert result.content[0].text == "No recordings yet. Transcribe or record audio in Sonorus first."


@pytest.fixture
def anyio_backend():
    return "asyncio"
