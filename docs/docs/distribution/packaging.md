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
        ├── python-dist/           ← python-build-standalone + every backend library (CPU)
        ├── app/                   ← Python source (FastAPI app)
        └── bin/ffmpeg             ← ffmpeg binary (ffmpeg-static)
```

The installer is self-contained: the app installs nothing on first launch and needs no internet to
start. Only model weights are downloaded later, on demand (Settings → Models).

User data lives outside the bundle in `app.getPath('userData')` and is never packaged:

```
~/.config/Sonorus/               (Linux — similar on macOS/Windows)
  .models/                       ← ML model weights (downloaded on demand)
  speaker_memory.db              ← transcripts + speaker memory
  recordings/                    ← live recordings + copies of imported audio
  settings.json                  ← user settings
  sonorus.log                    ← backend log
```

---

## Build pipeline

### 1. Bundle backend (`scripts/bundle-backend.js`)

Assembles `backend-dist/` for the current platform:

1. Downloads `python-build-standalone` (cached in `backend-dist/`) and extracts it into `python-dist/` —
   from scratch on every run, so libraries of an older lock never linger.
2. Installs every library from the platform's lock file into the interpreter's own `site-packages`:
   `pip install --no-deps --require-hashes --only-binary=:all: -r locks/packaged-<platform>-<arch>.txt`.
   Nothing is resolved at build time — the lock is installed exactly.
3. Copies `app/`.
4. Precompiles all Python code with `compileall --invalidation-mode unchecked-hash`. Such `.pyc` files
   are never revalidated against source timestamps, so they are used as is inside the read-only
   AppImage / `.app` and after the NSIS installer copies the files.
5. Copies the `ffmpeg` binary.

```bash
node scripts/bundle-backend.js
```

Python version: **3.12.10** (release 20250517 from `indygreg/python-build-standalone`).

Build platforms (one lock file each):

| Key | Installer |
|---|---|
| `darwin-arm64` | macOS Apple Silicon (`.dmg`), macOS 14 or later |
| `win32-x64` | Windows 64-bit (`.exe`, NSIS) |
| `linux-x64` | Linux 64-bit (`.AppImage`) |

The cached Python tarball stays out of the installers (`!*.tar.gz` filter in `package.json`).

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
npm run build:mac    # build:capture → bundle-backend.js → electron-builder
npm run build:win    # bundle-backend.js → electron-builder (x64)
npm run build:linux  # bundle-backend.js → electron-builder (x64)
```

Output goes to `dist/`.

---

## Python packages (lock files)

`requirements.packaged.txt` lists the direct dependencies of the packaged backend (not `requirements.txt`):

- PyTorch comes from `https://download.pytorch.org/whl/cpu` — **CPU only** (`+cpu` builds; macOS uses
  the PyPI wheels, which are CPU-only)
- Dev dependencies (`pytest`, etc.) are excluded

`locks/packaged-<platform>-<arch>.txt` pin every library — direct and transitive — with hashes, one
file per build platform. The same app version therefore always ships the same libraries. The macOS
lock targets macOS 14 (the oldest macOS with `onnxruntime` wheels), which makes macOS 14 the minimum
for the packaged app.

To change a dependency, edit `requirements.packaged.txt`, regenerate the locks and commit both:

```bash
node scripts/lock-backend.js   # needs uv on PATH, or UV=/path/to/uv
```

The script runs `uv pip compile` once per build platform (`--python-platform`, `--generate-hashes`).
`tests/build/` checks that the locks exist for every build platform, pin every package with a hash,
match `requirements.packaged.txt` and contain no CUDA packages.

GPU acceleration is not available in the packaged app — see
[Setup → GPU acceleration](../environment/setup.md#gpu-acceleration).

---

## Installer size

The bundled libraries make the installers large (Linux AppImage ≈ 1 GB). GitHub Releases refuses
assets over 2 GiB, so every CI build job runs `node scripts/check-installer-size.js dist` after
electron-builder and fails when an installer exceeds **1900 MiB**.

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
