---
sidebar_position: 1
---

# Setup

---

## End-user installation (packaged app)

Download the appropriate installer from [GitHub Releases](https://github.com/theoceankit/sonurus/releases).

| Platform | File | Notes |
|---|---|---|
| macOS Apple Silicon | `Sonorus-x.x.x-arm64.dmg` | Drag to `/Applications` |
| macOS Intel | `Sonorus-x.x.x-x64.dmg` | Drag to `/Applications` |
| Windows | `Sonorus Setup x.x.x.exe` | Standard NSIS installer |
| Linux | `Sonorus-x.x.x.AppImage` | `chmod +x` then run; [FUSE required](#linux-appimage) |

### First run

On first launch Sonorus shows a **Setup** screen and installs ML dependencies (~500 MB, one-time, requires internet). This takes a few minutes. All packages are stored in:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Sonorus/python-packages/` |
| Windows | `%APPDATA%\Sonorus\python-packages\` |
| Linux | `~/.config/Sonorus/python-packages/` |

After setup completes the app opens normally. Subsequent launches skip this step.

### HuggingFace token

Speaker diarization requires a free HuggingFace token with access to PyAnnote models.

1. Register at [huggingface.co](https://huggingface.co) and accept the terms on each PyAnnote model page.
2. Create a read token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
3. In Sonorus: **Settings → API Keys → HuggingFace token**.

Without a token, transcription will fail at the diarization step.

### macOS Gatekeeper

Builds from GitHub Releases are not code-signed. On first open:
> "Sonorus cannot be opened because it is from an unidentified developer."

**Fix:** right-click the `.app` → Open → Open.

### Windows SmartScreen

On first run, Windows may show:
> "Windows protected your PC"

**Fix:** click "More info" → "Run anyway".

### Linux AppImage

AppImages require FUSE. On Arch-based distros:
```bash
sudo pacman -S fuse2
```

For automatic desktop integration (taskbar icon, `.desktop` file):
```bash
yay -S appimagelauncher
```

---

## GPU acceleration

The packaged app installs **CPU-only PyTorch** by default. This works on all platforms but is significantly slower than GPU inference.

To use an NVIDIA GPU, reinstall PyTorch with CUDA support after the initial setup. From the app's `python-packages/` directory:
```bash
# Example for CUDA 12.8 — adjust index URL for your CUDA version
~/.config/Sonorus/python-packages/../.venv/bin/pip install \
  torch==2.8.0 torchaudio==2.8.0 \
  --index-url https://download.pytorch.org/whl/cu128 \
  --target ~/.config/Sonorus/python-packages
```

macOS does not support CUDA. Apple Silicon can use MPS, but WhisperX/ctranslate2 do not currently support it — CPU is the only option on Mac.

---

## Developer setup

### Requirements

- Python 3.12 (via pyenv recommended)
- Node.js 20+
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
```

### Run in dev mode

```bash
# Backend starts automatically when Electron launches
npm install
npm start
```

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

### Testing the packaged setup flow

```bash
# Forces the first-run setup screen in dev mode
SONORUS_TEST_SETUP=1 npm start
```

Installs into `~/.config/sonorus/python-packages/`. Reset with:
```bash
rm -rf ~/.config/sonorus/python-packages
```
