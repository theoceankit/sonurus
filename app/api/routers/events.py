"""WS /ws/events: what changed in the app's data, whoever changed it, for the UI
to follow (app/services/app_events.py). Today: note_changed."""
import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.app_events import app_events

router = APIRouter(tags=["events"])

_HEARTBEAT_INTERVAL = 10  # seconds between heartbeats when nothing changes


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    """Says connected once it hears every event, then sends each event.
    Heartbeats keep the connection alive while nothing changes."""
    await websocket.accept()
    loop = asyncio.get_running_loop()
    events: asyncio.Queue = asyncio.Queue()

    def on_event(event: dict) -> None:
        try:
            loop.call_soon_threadsafe(events.put_nowait, event)
        except RuntimeError:
            pass  # event loop already closed

    unsubscribe = app_events.subscribe(on_event)
    try:
        await websocket.send_json({"type": "connected"})
        while True:
            try:
                event = await asyncio.wait_for(events.get(), timeout=_HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                event = {"type": "heartbeat"}
            await websocket.send_json(event)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        unsubscribe()
