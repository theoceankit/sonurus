"""The API schema the UI generates its types from: FastAPI's own schema
plus what it cannot see. See docs/docs/ui/electron/data.md."""
import copy

from pydantic.json_schema import models_json_schema

from app.api.main import app
from app.api.schemas import (
    CallEndedEvent, EventsConnectedEvent, HeartbeatEvent, NoteChangedEvent, JobDoneEvent, JobFailedEvent, MicAppActiveEvent, RecordingFailedEvent,
    RecordingSourceLostEvent, RecordingSystemSilentEvent,
)

# WebSocket routes are not part of OpenAPI. QueueSnapshot, the other event of
# WS /ws/queue, is already there through GET /queue.
_QUEUE_EVENTS = (JobDoneEvent, JobFailedEvent, RecordingFailedEvent, RecordingSourceLostEvent,
                 RecordingSystemSilentEvent, MicAppActiveEvent, CallEndedEvent, HeartbeatEvent)
# WS /ws/events (app/services/app_events.py).
_APP_EVENTS = (EventsConnectedEvent, NoteChangedEvent)


def build_schema() -> dict:
    schema = copy.deepcopy(app.openapi())
    # Every release changes it, and nothing is generated from it.
    del schema["info"]["version"]
    _, events = models_json_schema(
        [(model, "serialization") for model in (*_QUEUE_EVENTS, *_APP_EVENTS)],
        ref_template="#/components/schemas/{model}",
    )
    schema["components"]["schemas"].update(events["$defs"])
    return schema
