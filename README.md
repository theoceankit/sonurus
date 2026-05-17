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

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 2. Install Python dependencies (see Dependencies section below)
pip install whisperx pyannote-audio torch torchaudio numpy scikit-learn \
            fastapi uvicorn python-dotenv

# 3. Install Electron dependencies
npm install

# 4. Create .env
cp .env.example .env
# Edit .env and set HF_TOKEN=your_token_here
```

The first run downloads model weights (~5 GB total) into `.models/`.

> A `requirements.txt` is not yet included. See [Dependencies](docs/docs/environment/dependencies.md) for the full package list with pinned versions.

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
