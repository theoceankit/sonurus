---
sidebar_position: 16
---

# AppEvents

`app/services/app_events.py` (`AppEvents`) passes on what changed in the app's data to whoever follows it. `WS /ws/events` ([API](../api/endpoints.md#ws-wsevents)) subscribes for each open socket and sends every event to the UI, which follows changes it did not make itself, such as a note an agent wrote through [MCP](../api/mcp.md).

Services are made per request, so the bus is one for the process: `app_events`. A service that publishes takes it in its constructor and falls back to `app_events`; tests give it a bus of their own.

- `subscribe(callback)` — `callback(event)` gets every event published from then on. Returns the function that stops it; calling that again does nothing.
- `publish(event)` — calls each subscriber in the publisher's thread, so a callback must be quick and must not block. One that raises is logged and the others still get the event. The socket's callback only hands the event to its event loop (`call_soon_threadsafe`).

| Event | Published by | When |
|---|---|---|
| `note_changed {transcript_id, version, writer}` | `TranscriptStorageService.save_note()`, `delete_note()` | after every write and delete of a note, `version` `null` for a delete |

Nothing is kept: a client that was not connected missed the events. `WS /ws/events` sends `{"type": "connected"}` first, once it is subscribed, and the UI reads again what it shows each time it gets it.

`WS /ws/queue` is apart: the queue sends its own snapshots and events ([TranscriptionQueue](TranscriptionQueue.md)).
