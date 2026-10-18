# Sonorus

A local desktop application for transcribing audio with persistent speaker identification across sessions.

Transcribes audio files using WhisperX, automatically matches speakers against a memory of known voices, lets the user review and correct speaker assignments, and updates speaker profiles after each session.

---

## Stack

| Component | Role |
|---|---|
| [WhisperX](https://github.com/m-bain/whisperX) | ASR + word-level timestamp alignment |
| [PyAnnote](https://github.com/pyannote/pyannote-audio) | Speaker diarization + embedding extraction |
| FastAPI + uvicorn | REST + WebSocket backend |
| Electron + Vanilla JS | Desktop UI |
| SQLite | Speaker memory and transcript storage |

---

## Install

Installers for Linux, macOS (Apple Silicon) and Windows are on the
[Releases](https://github.com/theoceankit/sonurus/releases) page. They include Python and every
library the app needs; transcription models are downloaded in **Settings → Models**. Per-platform
instructions: `docs/docs/build-and-install/`.

---

## Requirements (from source)

- Python 3.12
- Node.js 22.12+
- ffmpeg (for audio decoding)
- A [HuggingFace token](https://huggingface.co/settings/tokens) with access to the gated PyAnnote models
- CUDA optional (CPU works, slower)

On macOS, install Node.js and ffmpeg via Homebrew:

```bash
brew install node ffmpeg
```

---

## Setup

### 1. Python environment

```bash
python3.12 -m venv .venv
```

The commands below call `.venv/bin/...` directly, so the environment does not need to be activated.
On Windows, use `.venv\Scripts\...` instead.

### 2. Install PyTorch

PyTorch must be installed before the other packages because the right build depends on your hardware.

```bash
# NVIDIA GPU (Linux/Windows)
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128

# CPU only (Linux/Windows)
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu

# macOS: standard PyPI, CPU only
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0
```

For other configurations see [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/).

### 3. Install remaining dependencies

```bash
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_nltk_data.py   # sentence data for alignment (NLTK punkt_tab), into the venv
npm ci
```

On macOS, live recording also needs the system audio helper (requires Xcode Command Line Tools):

```bash
npm run build:capture
```

### 4. HuggingFace access

Accept the terms of use on each gated PyAnnote model page ("Agree and access repository"):

- [pyannote/speaker-diarization-community-1](https://hf.co/pyannote/speaker-diarization-community-1)
- [pyannote/embedding](https://hf.co/pyannote/embedding)

Then create a read token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
and enter it in the app under **Settings → API Keys**.

---

## Running

```bash
npm start
```

This starts the backend as well. A development build keeps its data (database, recordings, models)
apart from an installed Sonorus: in `~/.config/sonorus-dev` on Linux, in Electron's `userData` folder
on other platforms. Download a transcription model in **Settings → Models** before the first
transcription.

To run the backend alone (API work), put the token in `.env` (`cp .env.example .env`, set `HF_TOKEN`)
and start:

```bash
.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

It keeps its data in `$SONORUS_DATA_DIR`, or the current directory if that is unset.

---

## How it works

**Pipeline:**
```
copy audio → transcribe → extract embeddings → resolve speakers → build transcript
          → [user review] → commit → save
```

**Transcription queue:** imports and recordings are queued and transcribed one at a time in the background. The queue can be paused and resumed (a paused job starts over), reordered by drag and drop, and failed jobs retried; a live recording pauses it. It survives app restarts. Settings → *Start transcription* chooses whether new files start on their own or wait for Start.

**Speaker memory:** each speaker is stored as a UUID with a voice embedding in `speaker_memory.db`. On each new session, known speakers are matched by cosine similarity (threshold 0.75). Corrections made by the user feed back into the embeddings on commit, improving future recognition.

---

## Tests

```bash
.venv/bin/python -m pytest tests/ -v
node --test 'tests/renderer/*.test.js'
node --test 'tests/build/*.test.js'
```

Tests do not require ML models or audio files. See [CONTRIBUTING.md](CONTRIBUTING.md#tests).

---

## Documentation

Full documentation is in `docs/` (Docusaurus). To run locally:

```bash
cd docs && npm ci && npm start
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). If you work with an AI coding tool, it reads [AGENTS.md](AGENTS.md).
