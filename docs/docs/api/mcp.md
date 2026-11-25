---
sidebar_position: 2
---

# MCP server

The backend serves an [MCP](https://modelcontextprotocol.io) endpoint for agents on the same computer, such as Claude Code: they read the user's recordings through it and write their notes. It is off until the user turns it on in Settings → Integrations ([Settings](../ui/electron/settings.md#integrations)).

| | |
|---|---|
| Address | `http://127.0.0.1:8000/mcp` |
| Transport | Streamable HTTP, without sessions (`stateless_http`), answers as JSON (`json_response`): no SSE stream, no state between requests |
| Code | `app/mcp/server.py` (endpoint, server, tools), `app/mcp/tools.py` (what the tools answer), `app/mcp/note_tools.py` and `note_changes.py` (the note), mounted in `app/api/main.py` |
| Library | The official Python SDK, `mcp` (`MCPServer`) |

The endpoint runs inside the backend, so it answers while Sonorus runs, also with its window closed to the tray, and not when Sonorus is quit. There is no process of its own.

## Connecting Claude Code

```bash
claude mcp add --transport http --scope user sonorus http://127.0.0.1:8000/mcp
```

`--scope user` makes Sonorus available to Claude Code in every project. Settings → Integrations shows the address and this command, with Copy, while the server is on.

The backend has one port, 8000: a development backend and the installed app's are on the same address, and an agent reaches whichever runs.

## On and off

The switch is a setting of the backend, `mcp_enabled` in [AppSettings](../services/AppSettings.md), read and written with `GET`/`PUT /integrations/mcp` ([API Endpoints](endpoints.md#integrations)). It is off on a new installation.

While it is off, `/mcp` answers `404` as a path that does not exist; the backend need not restart for either change, as `McpEndpoint` asks the setting on every request (from memory). Reset preferences and Delete all data turn it off.

`/mcp` is not a REST route: it is not in `/openapi.json`, and the UI never calls it.

## Other sites and host names

The SDK's guard against DNS rebinding is on (`SECURITY` in `app/mcp/server.py`):

- a request with an `Origin` other than `http://127.0.0.1:*`, `http://localhost:*` or `http://[::1]:*` — a page of another site in a browser — is refused with `403`;
- a request with a `Host` other than `127.0.0.1:*`, `localhost:*` or `[::1]:*` — a name of another site that resolves to this computer — is refused with `421`.

Agents such as Claude Code send no `Origin` and are let in.

## Lifespan

The SDK runs each request in a task group that `StreamableHTTPSessionManager.run()` holds open. The app lifespan enters `mcp_endpoint.running()`, which makes a new session manager each time (a manager runs once). Until the lifespan has started, `/mcp` answers `404`.

## Tools

Tools take and give recordings by `recording_id` (the transcript id), times in a recording as `mm:ss` or `h:mm:ss`, dates as `YYYY-MM-DD` in local time. Their descriptions and messages are in English; the content of recordings is as it is. A tool reads the data through the same services as the REST API.

| Tool | Answers |
|---|---|
| `list_recordings` | Every recording, newest first, one line each: `- recording_id 7: Weekly sync, 2026-11-20, 45:12`. No recordings: a line saying to transcribe or record audio first. |
| `get_note` | The note of a recording: `Note of recording 7 (version 12):`, an empty line, then the note as Markdown. Without a note: `Recording 7 has no note yet (version 0): …`. |
| `append_note` | Adds Markdown at the end of the note, or makes it the note when there is none. |
| `replace_note` | Replaces the whole note with Markdown, given the `version` `get_note` read (`0`: no note). |
| `edit_note` | Replaces one place in the note: `old_text`, found exactly once in the Markdown `get_note` gives, becomes `new_text`. |

A refusal is one line, what happened and what to do, as an error result of the tool (`isError`): `Recording 9 not found: use list_recordings to see recording_ids.` The tools return it rather than raise `ToolError`, which the SDK would give with `Error executing tool <name>:` before it.

### The note

The note is written and read as the Markdown of [Note Markdown](../services/NoteMarkdown.md): `[12:34]` is a timecode and `@handle` a speaker of the base, chips in the editor; `@[Name]` someone not in the base, `@[Unknown speaker 2]` a speaker of this recording without a name. Who can be mentioned comes from `note_speakers()` in `app/services/transcript_text.py`: every speaker of the base, and this recording's speakers without a name by the label the editor shows (`unknown_speaker_names()`, a port of `unknownSpeakerNames` in the UI).

A write never refuses Markdown: what the note does not have is made simpler, an unknown handle stays text, and the converter's warnings follow the answer, one line each; the one about handles adds where to find them (`list_speakers`) and `@[Name]`.

- `append_note` puts the new blocks after the note's own, which stay as stored, empty lines at the edges of the new text left out. Empty Markdown is refused.
- `replace_note` refuses a note that is not at `version`: `The note of recording 7 changed since version 12 (now version 13): read it with get_note and replace again.` So an agent replaces only what it read, and what the user saved meanwhile is kept.
- `edit_note` matches `old_text` against the Markdown character for character, escapes included, and counts overlapping places. Not found, found more than once, an empty `old_text` and a recording without a note are refused, each with what to do. An empty `new_text` removes the text. The whole note is then written back from its Markdown, in [its normal form](../services/NoteMarkdown.md#without-loss).

Each write reads the note, changes it and stores it with the version it read (`save_note`/`delete_note` with `expected`), as `writer` `{kind: "mcp", name}`, `name` being the client's own (`clientInfo`), when the request carries it. The backend announces it (`note_changed`) and an open editor merges it with what the user is typing ([Notes](../ui/electron/notes.md#changes-from-elsewhere)). A note saved by someone else between the read and the write is read again, up to 3 times (`ATTEMPTS`), then: `The note of recording 7 keeps changing while it is written: try again in a moment.` `replace_note` is not tried again: the version is the agent's.

A write answers one line with the version it made: `Appended to the note of recording 7 (version 13).`, `Replaced …`, `Edited …`. A note that would read back the same is not written: `The note of recording 7 is unchanged (version 12).` A note left empty is deleted, as the editor does: `The note of recording 7 is now empty and was removed.`

## Network

The server makes no requests of its own. The SDK brings `opentelemetry-api`, which sends nothing without an OpenTelemetry SDK, and that is off ([Privacy](../privacy.md#third-party-telemetry)). What an agent does with what it reads is up to the agent: see [Privacy](../privacy.md#agents-connected-over-mcp).
