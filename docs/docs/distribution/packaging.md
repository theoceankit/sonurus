---
sidebar_position: 1
---

# Packaging

How Sonorus is assembled into distributable installers.

---

## Architecture

The packaged app consists of two parts bundled together by `electron-builder`:

```
Sonorus.app (or .exe / .AppImage)
  ├── Electron runtime + renderer (index.html, JS, CSS)
  └── resources/backend/           ← extraResources
        ├── python-dist/           ← python-build-standalone interpreter
        ├── app/                   ← Python source (FastAPI app)
        └── requirements.txt       ← CPU ML dependencies
```

User data lives outside the bundle in `app.getPath('userData')` and is never packaged:

```
~/.config/Sonorus/               (Linux — similar on macOS/Windows)
  python-packages/               ← pip install on first run
  .models/                       ← ML model weights (downloaded on demand)
  speaker_memory.db              ← transcripts + speaker memory
  .files/                        ← audio archive + .txt exports
  settings.json                  ← user settings
  sonorus.log                    ← backend log
```

---

## Build pipeline

### 1. Bundle backend (`scripts/bundle-backend.js`)

Downloads `python-build-standalone` (~50 MB) for the target platform and copies `app/` source into `backend-dist/`:

```bash
node scripts/bundle-backend.js          # first run: downloads + extracts Python
node scripts/bundle-backend.js          # subsequent: uses cached tarball, only copies app/
node scripts/bundle-backend.js --force  # re-extract Python (after version bump)
```

Python version: **3.12.10** (release 20250517 from `indygreg/python-build-standalone`).

Supported platforms:

| Key | Filename |
|---|---|
| `darwin-arm64` | Apple Silicon Mac |
| `darwin-x64` | Intel Mac |
| `win32-x64` | Windows 64-bit |
| `linux-x64` | Linux 64-bit |
| `linux-arm64` | Linux ARM64 |

### 2. Native binary: `sonorus-capture` (macOS only)

macOS system audio capture uses a Swift binary built from `native/macos/sonorus-capture/main.swift` via ScreenCaptureKit. It is compiled with `swiftc` (part of Xcode Command Line Tools):

```bash
xcode-select --install   # one-time, if not already installed
npm run build:capture    # compiles → electron/resources/mac/sonorus-capture
```

`npm run build:mac` calls this step automatically. `build:win` and `build:linux` skip it — system audio on those platforms goes through ffmpeg (Linux) or the Electron renderer (Windows) without a native binary.

### 3. electron-builder

Packages the Electron app + `backend-dist/` into the final installer:

```bash
npm run build:mac    # build:capture → bundle-backend.js → electron-builder (arm64 + x64)
npm run build:win    # bundle-backend.js → electron-builder (x64)
npm run build:linux  # bundle-backend.js → electron-builder (x64)
```

Output goes to `dist/`.

---

## First-run setup

When the packaged app launches and `$userData/python-packages/.installed` does not exist:

1. `backend.js` calls `needsSetup()` → `true`
2. `main.js` loads `setup.html` in the window (welcome screen with **Install & Launch** button)
3. User clicks **Install & Launch** → renderer sends `start-setup` IPC to main
4. `main.js` unblocks and calls `startBackend()` → `backend.js` runs pip install
5. pip output is streamed to the setup screen via `setup-progress` IPC events
6. On success, writes `python-packages/.installed` marker
7. `backend.js` spawns uvicorn with `PYTHONPATH=python-packages/`
8. `main.js` loads `index.html`

To test the setup flow without building a packaged app:
```bash
rm ~/.config/Sonorus/python-packages/.installed
SONORUS_TEST_SETUP=1 npm start
```

The setup screen is self-contained (`setup.html`) and does not depend on the main renderer stack.

---

## Python packages (`requirements.packaged.txt`)

The packaged app uses `requirements.packaged.txt` (not `requirements.txt`). Differences:

- PyTorch is installed from `https://download.pytorch.org/whl/cpu` — **CPU only**
- Dev dependencies (`pytest`, etc.) are excluded

CUDA support requires manual reinstall after setup. See [Setup → GPU acceleration](../environment/setup.md#gpu-acceleration).

---

## Icons

| File | Purpose |
|---|---|
| `electron/assets/icon.png` | App icon with background (1024×1024) — dock, taskbar, `.icns`, `.ico`, Linux AppImage |
| `electron/assets/logo.png` | Transparent S logo (1024×1024) — titlebar and favicon inside the app |
| `build/icons/icon.icns` | macOS (generated from `icon.png`) |
| `build/icons/icon.ico` | Windows (generated from `icon.png`) |

Icons are generated from `icon.png` using the `png2icons` npm package. Regenerate:
```bash
node -e "
const p=require('png2icons'),fs=require('fs');
const i=fs.readFileSync('electron/assets/icon.png');
fs.writeFileSync('build/icons/icon.icns',p.createICNS(i,p.BILINEAR,0));
fs.writeFileSync('build/icons/icon.ico',p.createICO(i,p.BILINEAR,0,true));
"
```

---

## Code signing

Current releases are **unsigned**. Users will see:

- **macOS**: Gatekeeper warning → right-click → Open to bypass
- **Windows**: SmartScreen warning → "More info" → "Run anyway"
- **Linux**: no signing required

Code signing requires an Apple Developer account ($99/yr) for macOS notarization and an EV certificate ($300+/yr) for Windows SmartScreen trust.
