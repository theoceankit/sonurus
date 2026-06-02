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
| macOS | `~/Library/Application Support/Sonorus/settings.json` |
| Windows | `%APPDATA%\Sonorus\settings.json` |
| Linux | `~/.config/Sonorus/settings.json` |

| Setting | Key | Description |
|---|---|---|
| HuggingFace token | `hfToken` | Required for PyAnnote diarization |
| Transcription language | `transcribeLang` | Whisper language code, or `"auto"` |
| Whisper model | `transcribeModel` | Model ID (e.g. `"small"`, `"large-v3"`) |
| Interface scale | `scale` | Zoom factor in percent |
| Export format | `exportFormat` | `"txt"`, `"md"`, `"srt"`, `"vtt"`, `"json"` |

---

## Environment variables

Used when the backend is started manually (`uvicorn ...`) or set by `electron/backend.js` when launching the packaged app.

| Variable | Default | Description |
|---|---|---|
| `HF_TOKEN` | — | HuggingFace token. In packaged/`npm start` mode, taken from `settings.hfToken`. In manual mode, load from `.env`. |
| `SONORUS_DATA_DIR` | `.` (CWD) | Root directory for user data: models, database, archive, log. Set automatically to `app.getPath('userData')` when launched via Electron. |
| `VERBOSE` | `false` | If `true`, ML library warnings are printed. Useful for debugging. |
| `LOG_LEVEL` | `info` | Server log level: `debug`, `info`, `warning`, `error`, `off`. |
| `LOG_FILE` | — | If set, logs are also written to this file. Set to `$SONORUS_DATA_DIR/sonorus.log` in packaged mode. |
| `DB_PATH` | `$SONORUS_DATA_DIR/speaker_memory.db` | Override the SQLite database path. |

### SONORUS_DATA_DIR

The most important variable for production deployments. All user data resolves relative to it:

```
$SONORUS_DATA_DIR/
  .models/
    whisper/          ← Whisper model weights
    hf/               ← PyAnnote model weights
    alignment/        ← wav2vec2 alignment models
  speaker_memory.db   ← Speaker memory + transcripts
  .files/             ← Audio archive + .txt exports
  sonorus.log         ← Backend log (packaged mode)
  settings.json       ← App settings (written by Electron)
  python-packages/    ← pip-installed ML deps (packaged mode)
```

In dev mode (`npm start` without `SONORUS_TEST_SETUP`), `SONORUS_DATA_DIR` is still set by Electron to `app.getPath('userData')`, so models and the database also go to the user data directory — not the project root.

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
