---
sidebar_position: 2
---

# MCP server

The backend serves an [MCP](https://modelcontextprotocol.io) endpoint for agents on the same computer, such as Claude Code: they read the user's recordings through it. It is off until the user turns it on in Settings → Integrations ([Settings](../ui/electron/settings.md#integrations)).

| | |
|---|---|
| Address | `http://127.0.0.1:8000/mcp` |
| Transport | Streamable HTTP, without sessions (`stateless_http`), answers as JSON (`json_response`): no SSE stream, no state between requests |
| Code | `app/mcp/server.py` (endpoint, server, tools), `app/mcp/tools.py` (what the tools answer), mounted in `app/api/main.py` |
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

## Network

The server makes no requests of its own. The SDK brings `opentelemetry-api`, which sends nothing without an OpenTelemetry SDK, and that is off ([Privacy](../privacy.md#third-party-telemetry)). What an agent does with what it reads is up to the agent: see [Privacy](../privacy.md#agents-connected-over-mcp).
