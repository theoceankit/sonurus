---
sidebar_position: 1
---

# Setup

---

## End-user installation (packaged app)

Download the installer from [GitHub Releases](https://github.com/theoceankit/sonurus/releases), or
build it yourself. Building, installing, first launch, data locations and uninstalling are described
per operating system in **Build and install**:

| Platform | File | Guide |
|---|---|---|
| Linux x64 | `Sonorus-x.x.x.AppImage` | [Linux](../build-and-install/linux.md) |
| macOS Apple Silicon, 14+ | `Sonorus-x.x.x-arm64.dmg` | [macOS](../build-and-install/macos.md) |
| Windows x64 | `Sonorus Setup x.x.x.exe` | [Windows](../build-and-install/windows.md) |

The installer already contains Python and every library the app needs: Sonorus opens straight to the
main screen, with no setup step and no internet connection required. Transcription models are
downloaded on demand in **Settings → Models**; once downloaded, transcription works offline.

### HuggingFace token

Speaker diarization requires a free HuggingFace token with access to PyAnnote models.

1. Register at [huggingface.co](https://huggingface.co) and accept the terms on each PyAnnote model page.
2. Create a read token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
3. In Sonorus: **Settings → API Keys → HuggingFace token**.

Without a token, transcription will fail at the diarization step.

---

## GPU acceleration

The installers ship **CPU-only PyTorch**. On Linux and Windows, **Settings → GPU acceleration**
downloads the CUDA build once (NVIDIA GPU with compute capability 7.0 or newer, driver 570 or newer)
and restarts the backend on it — see [GPU acceleration](../ui/electron/gpu-acceleration.md). The
bundled libraries themselves are never modified.

From source, install a CUDA build of PyTorch (see [Developer setup](#developer-setup)) — the backend
picks `cuda` automatically when `torch.cuda.is_available()`; the Settings section then only shows the
device ("Development build").

macOS does not support CUDA. Apple Silicon can use MPS, but WhisperX/ctranslate2 do not currently support it — CPU is the only option on Mac.

---

## Developer setup

### Requirements

- Python 3.12 (via pyenv recommended)
- Node.js 22.12+
- CUDA 12.x (optional, for GPU acceleration)
- HuggingFace account + token

### Python environment

```bash
# Create virtual environment
python3.12 -m venv .venv

# Install PyTorch (CUDA example for cu128 — adjust for your setup)
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 \
  --index-url https://download.pytorch.org/whl/cu128

# Install remaining dependencies
.venv/bin/pip install -r requirements.txt

# Sentence data for alignment (NLTK punkt_tab) into .venv/nltk_data
.venv/bin/python scripts/fetch_nltk_data.py
```

The app never downloads NLTK data by itself and does not use `~/nltk_data`: without this step a
transcription fails at alignment with an error that names the missing data.

### Run in dev mode

```bash
# Backend starts automatically when Electron launches
npm ci
npm start
```

`npm ci` does not download the Electron binary: the first `npm start` does (or run `npx install-electron`
beforehand), so the first start needs the network once.

**macOS only:** live recording requires the `sonorus-capture` binary. Build it once before running:

```bash
# Requires Xcode Command Line Tools: xcode-select --install
npm run build:capture
```

The binary is placed at `electron/resources/mac/sonorus-capture` and picked up automatically at runtime.

Set the HuggingFace token via **Settings → API Keys** in the UI. It is stored in `settings.json` and passed to the backend as `HF_TOKEN` at startup.

Alternatively, create a `.env` file for the backend (loaded by `python-dotenv`):
```env
HF_TOKEN=hf_your_token_here
VERBOSE=false
```

> **Note:** The `.env` file is loaded only when the backend is started manually (`uvicorn ...`). When started via Electron (`npm start`), the token comes from Settings.

### Tests

```bash
.venv/bin/python -m pytest tests/ -v
```

### Testing a packaged build

Build an installer for the current platform (see [Packaging](../distribution/packaging.md)) and run it
with an isolated data directory, e.g. on Linux:

```bash
npm run build:linux
./dist/Sonorus-*.AppImage --user-data-dir=/tmp/sonorus-test
```
