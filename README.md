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

## Requirements

- Python 3.11+
- Node.js (for Electron)
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

PyTorch must be installed before the other packages because the right version depends on your hardware.

```bash
# CUDA 12.x (Linux/Windows GPU)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# CPU only (Linux/Windows)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# macOS (Apple Silicon or Intel) — standard PyPI, no special index needed
pip install torch torchaudio
```

For other configurations see [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/).

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

Get a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). You also need to accept the terms of use for each gated PyAnnote model — visit each page and click "Accept conditions":

- [pyannote/embedding](https://hf.co/pyannote/embedding)
- [pyannote/speaker-diarization-community-1](https://hf.co/pyannote/speaker-diarization-community-1)
- [pyannote/segmentation](https://hf.co/pyannote/segmentation)

> The first run downloads model weights (~5 GB) into `.models/`.

**macOS SSL fix:** if NLTK downloads fail with an SSL error during the alignment step, add the following to `.env` (replace the path with the output of `.venv/bin/python -c "import certifi; print(certifi.where())"`):

```
SSL_CERT_FILE=/path/to/.venv/lib/python3.11/site-packages/certifi/cacert.pem
REQUESTS_CA_BUNDLE=/path/to/.venv/lib/python3.11/site-packages/certifi/cacert.pem
```

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
