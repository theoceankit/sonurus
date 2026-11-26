---
sidebar_position: 15
---

# AppSettings

`app/services/app_settings.py` (`AppSettings`) keeps the settings the backend needs itself, in the table `app_settings` of the main database (`key TEXT PRIMARY KEY, value TEXT NOT NULL`). The table is made with `CREATE TABLE IF NOT EXISTS` when the service is made, outside the versioned schema.

The values are read once, when the service is made, and answered from memory afterwards: a check on every request, such as the switch of `/mcp`, costs no database read. A write goes to the database and to memory together.

| Key | Values | Default | Used by |
|---|---|---|---|
| `mcp_enabled` (`MCP_ENABLED`) | `"1"` / `"0"` | off | [MCP server](../api/mcp.md), `GET`/`PUT /integrations/mcp` |
| `use_gpu` (`USE_GPU`) | `"1"` / `"0"` | on | the device of transcription jobs, `GET /gpu`, `PUT /gpu/device` |

- `get_bool(key)` and `set_bool(key, value)`; a key missing from the table has its default from `DEFAULTS` (off when not listed).
- `job_device(settings)` — the device of the next transcription job: `cuda` only if PyTorch can use the GPU (`config.DEVICE`) and `use_gpu` is on, else `cpu`. The queue asks it when each job starts.
- `clear()` deletes every row: each setting goes back to its default. `DataResetService` calls it for `POST /data/reset`.

The API has one instance, `get_app_settings()` in `app/api/dependencies.py`; tests get one on a database of their own (`tests/conftest.py`).

The handle format is a setting too, but older: it is kept in `_meta` by [SpeakerMemoryService](SpeakerMemoryService.md).
