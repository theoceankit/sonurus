"""The schema in ui/src/api/openapi.json, which the new UI's types come from,
stays what the code serves."""
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import routers
from app.api.main import app
from app.api.openapi_schema import build_schema
from app.api.schemas import HeartbeatEvent

SCHEMA_FILE = Path(__file__).resolve().parent.parent / "ui" / "src" / "api" / "openapi.json"


def test_the_committed_schema_matches_the_code():
    committed = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    assert committed == build_schema(), "The API changed: run npm run gen:api and commit the result"


def test_the_schema_has_no_version_a_release_would_change():
    assert "version" not in build_schema()["info"]


def test_the_schema_describes_the_queue_events():
    schemas = build_schema()["components"]["schemas"]
    for name in ("QueueSnapshot", "JobDoneEvent", "JobFailedEvent", "HeartbeatEvent"):
        assert "type" in schemas[name]["required"], name


def test_response_fields_with_a_default_are_required_for_the_client():
    schemas = build_schema()["components"]["schemas"]
    assert "unassigned" in schemas["SegmentResponse"]["required"]
    assert "title" in schemas["TranscriptResponse"]["required"]
    assert "last_seen" in schemas["SpeakerResponse"]["required"]


def test_the_served_schema_stays_plain_openapi():
    served = TestClient(app).get("/openapi.json").json()
    assert "version" in served["info"]
    assert "JobDoneEvent" not in served["components"]["schemas"]


def test_a_heartbeat_matches_its_model(monkeypatch):
    monkeypatch.setattr(routers.transcription, "_HEARTBEAT_INTERVAL", 0.01)
    with TestClient(app).websocket_connect("/ws/queue") as ws:
        ws.receive_json()  # the first snapshot
        event = ws.receive_json()
    assert HeartbeatEvent.model_validate(event).model_dump() == event
