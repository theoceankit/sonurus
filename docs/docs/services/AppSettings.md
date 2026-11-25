---
sidebar_position: 15
---

# AppSettings

`app/services/app_settings.py` (`AppSettings`) keeps the settings the backend needs itself, in the table `app_settings` of the main database (`key TEXT PRIMARY KEY, value TEXT NOT NULL`). The table is made with `CREATE TABLE IF NOT EXISTS` when the service is made, outside the versioned schema.

The values are read once, when the service is made, and answered from memory afterwards: a check on every request, such as the switch of `/mcp`, costs no database read. A write goes to the database and to memory together.

| Key | Values | Default | Used by |
|---|---|---|---|
| `mcp_enabled` (`MCP_ENABLED`) | `"1"` / `"0"` | off | [MCP server](../api/mcp.md), `GET`/`PUT /integrations/mcp` |

- `get_bool(key, default=False)` and `set_bool(key, value)`.
- `clear()` deletes every row: each setting goes back to its default. `DataResetService` calls it for `POST /data/reset`.

The API has one instance, `get_app_settings()` in `app/api/dependencies.py`; tests get one on a database of their own (`tests/conftest.py`).

The handle format is a setting too, but older: it is kept in `_meta` by [SpeakerMemoryService](SpeakerMemoryService.md).
