---
sidebar_position: 97
---

# Privacy

Sonorus runs on your computer. Audio, transcripts and speaker profiles stay in the data directory
(see [SONORUS_DATA_DIR](environment/configuration.md#sonorus_data_dir)); Sonorus sends no usage data
to anyone.

## Network requests

Sonorus goes online only to download what it needs to run:

| Request | When | Where to |
|---|---|---|
| Model download (Whisper, diarization, alignment) | You start it in Settings → Models, or the alignment model dialog | Hugging Face Hub (`huggingface_hub.snapshot_download`, with your Hugging Face token) |
| GPU acceleration download | You start it in Settings → GPU acceleration (packaged Linux / Windows) | The wheel URLs of the bundled GPU manifest (`pypi.nvidia.com`, `download-r2.pytorch.org`) |
| NLTK sentence tokenizer data (`punkt_tab`) | The first alignment, if it is not in `~/nltk_data` yet — downloaded by WhisperX | NLTK data on GitHub |

Transcription itself is offline: the pipeline process runs with `HF_HUB_OFFLINE=1`, so a missing
model is an error, never a download in the middle of a job.

## Third-party telemetry

Some libraries Sonorus runs report usage to their authors by default. Sonorus switches all of it off
with the libraries' own switches:

| Variable | Value | What it turns off |
|---|---|---|
| `PYANNOTE_METRICS_ENABLED` | `false` | pyannote.audio OpenTelemetry metrics (sent to `otel.pyannote.ai`: models and pipelines loaded, duration of processed files) |
| `OTEL_SDK_DISABLED` | `true` | The OpenTelemetry SDK that pyannote.audio sets up at import — a no-op even if a pyannote release ignores its own switch |
| `HF_HUB_DISABLE_TELEMETRY` | `1` | Hugging Face Hub and Transformers usage telemetry, model downloads included |
| `DO_NOT_TRACK` | `1` | The cross-tool opt-out, honoured by `huggingface_hub` and others |

onnxruntime (loaded with pyannote in the pipeline process) has no environment switch: its
Windows builds report telemetry events through Windows diagnostic data unless
`onnxruntime.disable_telemetry_events()` is called, so the pipeline process calls it before any model
loads (`app.disable_onnxruntime_telemetry()`; a no-op on macOS and Linux).

The variables are set in `app/__init__.py`, which Python runs before any other backend module — so before
pyannote, WhisperX or Transformers is imported — in the backend and in every child process it starts
(the pipeline, model downloads), which also inherit them. The values are assigned, not defaulted:
setting these variables in your environment or in `.env` cannot turn telemetry back on.

`tests/test_telemetry.py` covers this, and `scripts/check-bundled-imports.js` checks it on the
bundled backend of every installer build.

## Electron app

The app starts no crash reporter, contains no analytics and loads no remote content: the window shows
local files and talks only to the backend on `127.0.0.1`.

Spell checking is off (`electron/main.js`): `spellcheck: false` in the window, and the session has the
spell checker disabled and no languages. With a language set, Chromium on Windows and Linux downloads
Hunspell dictionaries from Google (`redirector.gvt1.com`) at start-up; an empty language list is what
stops that download. macOS uses the system spell checker and downloads nothing.

`tests/renderer/no-third-party-requests.test.js` covers this.
