---
sidebar_position: 2
---

# Configuration

Sonorus is configured through two layers:

- **Settings UI** — user-facing settings stored in `settings.json` (HF token, model choice, language, export format, etc.)
- **Environment variables** — low-level server configuration, primarily relevant in dev mode

---

## Settings UI

Accessible via the gear icon in the Electron app. Settings are read and written via IPC (`readSettings` / `writeSettings`) and stored in:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/sonorus/settings.json` |
| Windows | `%APPDATA%\sonorus\settings.json` |
| Linux | `~/.config/sonorus/settings.json` |

These are the paths of the installed app. Dev mode (`npm start`) uses `sonorus-dev` instead of `sonorus` — see [SONORUS_DATA_DIR](#sonorus_data_dir).

| Setting | Key | Description |
|---|---|---|
| HuggingFace token | `hfToken` | Required for PyAnnote diarization |
| Transcription language | `transcribeLang` | Whisper language code, or `"auto"` |
| Whisper model | `transcribeModel` | Default model ID (e.g. `"small"`, `"large-v3"`); `null` until a Whisper model is installed — there is no built-in default |
| Previous Whisper models | `transcribeModelHistory` | The last five default models, oldest first; a deleted default falls back to the latest one still installed |
| Interface scale | `scale` | Zoom factor in percent |
| Export format | `exportFormat` | `"txt"`, `"md"`, `"srt"`, `"vtt"`, `"json"` |

---

## Environment variables

Used when the backend is started manually (`uvicorn ...`) or set by `electron/backend.js` when launching the packaged app.

| Variable | Default | Description |
|---|---|---|
| `HF_TOKEN` | — | HuggingFace token. In packaged/`npm start` mode, taken from `settings.hfToken`. In manual mode, load from `.env`. |
| `SONORUS_DATA_DIR` | `.` (CWD) | Root directory for user data: models, database, audio, log. Set automatically to `app.getPath('userData')` when launched via Electron. |
| `VERBOSE` | `false` | If `true`, ML library warnings are printed. Useful for debugging. |
| `LOG_LEVEL` | `info` | Server log level: `debug`, `info`, `warning`, `error`, `off`. |
| `LOG_FILE` | — | If set, logs are also written to this file. Set to `$SONORUS_DATA_DIR/sonorus.log` in packaged mode. |
| `SONORUS_PACKAGED` | — | `1` when the installed app started the backend (set by Electron); reported by `GET /health` as `packaged`. |
| `DB_PATH` | `$SONORUS_DATA_DIR/speaker_memory.db` | Override the SQLite database path. |

The backend also sets `PYANNOTE_METRICS_ENABLED`, `OTEL_SDK_DISABLED`, `HF_HUB_DISABLE_TELEMETRY` and `DO_NOT_TRACK` itself, overriding any value you set — third-party telemetry stays off (see [Privacy](../privacy.md)).

### SONORUS_DATA_DIR

The most important variable for production deployments. All user data resolves relative to it:

```
$SONORUS_DATA_DIR/
  .models/
    whisper/          ← Whisper model weights
    hf/               ← PyAnnote model weights
    alignment/        ← wav2vec2 alignment models
  speaker_memory.db   ← Speaker memory + transcripts
  recordings/         ← Audio referenced by the DB: live recordings (sonorus-rec-*)
                        and copies of imported files (sonorus-import-*)
  sonorus.log         ← Backend log (packaged mode)
  settings.json       ← App settings (written by Electron)
```

Electron sets `SONORUS_DATA_DIR` to `app.getPath('userData')`, in dev mode too, so models and the database go to the user data directory — not the project root. The installed app and dev mode keep their data apart (`electron/backend-identity.js`):

| Mode | Data directory |
|---|---|
| Installed app | `sonorus` in the OS app data folder: `~/.config/sonorus`, `~/Library/Application Support/sonorus`, `%APPDATA%\sonorus` |
| Dev mode (`npm start`) | `sonorus-dev` in the same folder: `~/.config/sonorus-dev`, … |
| Either, started with `--user-data-dir=<dir>` | `<dir>` |

The installed app's name differs only in case (`Sonorus`), which is the same folder on macOS and Windows, so dev mode sets its own folder before the app is ready. Data of an older dev setup stays in `sonorus`; to keep using it in dev mode, copy it once while nothing runs: `cp -r ~/.config/sonorus ~/.config/sonorus-dev`.

If a backend already answers on port 8000 when the app starts, Electron reuses it only if it is its own — `GET /health` reports the backend's data directory and whether the installed app started it:

- **Installed app** — reuses a backend serving its own data directory (e.g. one that outlived a crash). Any other backend — dev mode, another data directory, an older Sonorus or another program — stops the start with an error dialog naming what holds the port.
- **Dev mode** — reuses any Sonorus backend that the installed app did not start, e.g. one started manually with `uvicorn`; its `SONORUS_DATA_DIR` then applies. The installed app's backend stops the start with an error dialog.

Live recordings end up in the `recordings/` of the backend in use: the UI uploads them (`POST /audio/recordings`) and only the backend writes files there.

### .env file (dev only)

When the backend is started manually (`uvicorn ...`), variables are loaded from `.env` via `python-dotenv`:

```env
HF_TOKEN=hf_your_token_here
VERBOSE=false
# DB_PATH=./speaker_memory.db   # override if needed
```

The `.env` file is **not used** when the backend is started by Electron — in that case all variables are set programmatically by `electron/backend.js`.

---

## VERBOSE flag

Controls ML library noise suppression. When `false` (default), suppression runs in two layers:

1. **Import-time** (`app/api/main.py`): suppresses pyannote/torchcodec warnings on module load.
2. **Inference thread** (`app/api/routers/transcription.py`): suppresses warnings emitted during the ML pipeline.

Loggers suppressed at runtime: `whisperx.*`, `lightning.*`, `pytorch_lightning`.

Set `VERBOSE=true` when debugging transcription or diarization issues.
