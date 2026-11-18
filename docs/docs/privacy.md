---
sidebar_position: 97
---

# Privacy

Sonorus runs on your computer. Audio, transcripts, speaker profiles and speaker photos stay in the data directory
(see [SONORUS_DATA_DIR](environment/configuration.md#sonorus_data_dir)); Sonorus sends no usage data
to anyone.

## Network requests

Sonorus goes online only to download what it needs to run:

| Request | When | Where to |
|---|---|---|
| Model download (Whisper, diarization, alignment) | You start it in Settings → Models, or the alignment model dialog | Hugging Face Hub, with your Hugging Face token: the list of the repo's files and their sizes (`list_repo_files`, `model_info`), then the files (`snapshot_download`) from the Hub's CDN; only if the Hub refuses that download, the same files from its Xet storage (`cas-server.xethub.hf.co`) |
| GPU acceleration download | You start it in Settings → GPU acceleration (packaged Linux / Windows) | The wheel URLs of the bundled GPU manifest (`pypi.nvidia.com`, `download-r2.pytorch.org`) |

Transcription itself is offline: the pipeline process runs with `HF_HUB_OFFLINE=1` and refuses
`torch.hub` downloads (which `HF_HUB_OFFLINE` does not cover), so a missing model is an error, never
a download in the middle of a job. Every alignment model, English, French, German, Spanish and
Italian included, is a Hugging Face repo downloaded in Settings: WhisperX's own models for those
five languages, which `torch.hub` would fetch from `download.pytorch.org`, are never used. The sentence data alignment needs
(NLTK `punkt_tab`) ships with the app: the pipeline process reads it only from the app's Python
(`<python>/nltk_data`) and refuses NLTK downloads, so `~/nltk_data` is neither read nor written.

## Third-party telemetry

Some libraries Sonorus runs report usage to their authors by default. Sonorus switches all of it off
with the libraries' own switches:

| Variable | Value | What it turns off |
|---|---|---|
| `PYANNOTE_METRICS_ENABLED` | `false` | pyannote.audio OpenTelemetry telemetry (traces sent to `otel.pyannote.ai`: models and pipelines loaded, duration of processed files) |
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

`tests/electron/no-third-party-requests.test.js` covers this.

## Apps that use a microphone

To suggest a recording when a call seems to start, the backend asks the local sound server (Linux),
the audio system of Windows or CoreAudio on macOS (both through the `sonorus-capture` helper) which other apps are recording a microphone ([MicActivityService](services/MicActivityService.md)). Only
the app's name is read (on Windows and macOS, from its program file or app bundle), never its audio, and nothing leaves the computer. The names of the apps
seen are kept in `app-state.json` in the app's data folder, for the list in Settings → Notifications.
Turning the notifications off does not stop the backend from asking; `SONORUS_MIC_WATCH=0` does.

## Recording system audio

System audio is recorded only while a recording you started runs, into the recording's file on your
computer. On macOS it is a Core Audio tap of the sound every app plays: the system asks once for
the System Audio Recording permission (System Settings → Privacy & Security → Screen & System Audio
Recording), and Sonorus asks for nothing broader — no Screen Recording, no screen content. On
Windows it is a loopback of the chosen output device, on Linux the monitor of an output; neither
asks for a permission. See [Live recording](ui/electron/live-recording.md).
