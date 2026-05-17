# Whisper Project

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

## Requirements

- Python 3.11+
- Node.js (for Electron)
- A [HuggingFace token](https://huggingface.co/settings/tokens) with access to the gated PyAnnote models
- CUDA optional (CPU works, slower)

---

## Setup

### 1. Python environment

```bash
python -m venv .venv
```

Activate the environment — **you need to do this every time you open a new terminal**:

```bash
# macOS / Linux
source .venv/bin/activate

# Windows
.venv\Scripts\activate
```

Your prompt will show `(.venv)` when the environment is active.

### 2. Install PyTorch

PyTorch must be installed before the other packages because the right version depends on your hardware (CUDA or CPU).

Go to [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/), select your OS and whether you have a GPU, and copy the install command. Example:

```bash
# CUDA 12.x (GPU)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# CPU only
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

### 3. Install remaining dependencies

```bash
pip install -r requirements.txt
```

### 4. Install Electron dependencies

```bash
npm install
```

### 5. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set your HuggingFace token:

```
HF_TOKEN=your_token_here
```

Get a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). You also need to accept the terms of use for each PyAnnote model on HuggingFace (links in [Dependencies](docs/docs/environment/dependencies.md#gated-pyannote-models)).

> The first run downloads model weights (~5 GB) into `.models/`.

---

## Running

### Electron UI

```bash
# Terminal 1 — start the backend
.venv/bin/uvicorn app.api.main:app --port 8000

# Terminal 2 — start the desktop app
npm start
```

### CLI

```bash
# Place a WAV file at testdata/output.wav, then:
.venv/bin/python main.py
```

### Convert video to WAV

```bash
.venv/bin/python converter.py
```

---

## How it works

**Pipeline:**
```
transcribe → extract embeddings → resolve speakers → build transcript
          → [user review] → commit → save → archive
```

**Speaker memory:** each speaker is stored as a UUID with a voice embedding in `speaker_memory.db`. On each new session, known speakers are matched by cosine similarity (threshold 0.75). Corrections made by the user feed back into the embeddings on commit, improving future recognition.

---

## Tests

```bash
.venv/bin/python -m pytest tests/ -v
```

Tests do not require ML models or audio files.

---

## Documentation

Full documentation is in `docs/` (Docusaurus). To run locally:

```bash
cd docs && npm install && npm start
```
