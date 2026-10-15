---
sidebar_position: 1
---

# Packaging

How Sonorus is assembled into distributable installers. Step-by-step building and installing per
operating system: [Build and install](../build-and-install/linux.md) (Linux, macOS, Windows).

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
   On Windows it then copies the Microsoft Visual C++ 2015–2022 runtime (`msvcp140*.dll`,
   `vcruntime140*.dll`, `concrt140.dll`, `vcomp140.dll`) from the build machine's `System32` next to
   `python.exe`, see [Visual C++ runtime](#visual-c-runtime-windows).
2. Installs every library from the platform's lock file into the interpreter's own `site-packages`:
   `pip install --no-deps --require-hashes --only-binary=:all: -r locks/packaged-<platform>-<arch>.txt`.
   Nothing is resolved at build time — the lock is installed exactly.
3. Copies `app/`.
4. Precompiles all Python code with `compileall --invalidation-mode unchecked-hash`. Such `.pyc` files
   are never revalidated against source timestamps, so they are used as is inside the read-only
   AppImage / `.app` and after the NSIS installer copies the files.
5. Copies the `ffmpeg` binary.
6. Copies the platform's GPU manifest (`locks/gpu-<platform>-<arch>.json`) to
   `backend-dist/gpu-manifest.json` — Linux and Windows only, see [GPU manifests](#gpu-manifests).

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

#### Visual C++ runtime (Windows)

The Windows wheels (PyTorch, CTranslate2, ONNX Runtime, …) link against the Microsoft Visual C++
2015–2022 runtime. The Python archive carries only `vcruntime140.dll` and `vcruntime140_1.dll`, and a
clean Windows has no `msvcp140.dll`: without it `torch\lib\c10.dll` fails to load
(`[WinError 126]`) and every transcription fails. The build therefore ships the runtime app-locally —
the DLLs in `python-dist\` are found by the loader as the application directory of `python.exe` — so
users install no `vc_redist`. The two `vcruntime140*.dll` of the archive are replaced as well, so the
C runtime is never older than the C++ library.

The build machine needs the runtime installed (GitHub's Windows runners have it); without it
`bundle-backend.js` stops and names the missing DLLs. Install it with
[`vc_redist.x64.exe`](https://aka.ms/vs/17/release/vc_redist.x64.exe).

### 2. Native binaries: system audio helpers (macOS, Windows)

macOS system audio capture uses a Swift binary built from `native/macos/sonorus-capture/main.swift` via ScreenCaptureKit. It is compiled with `swiftc` (part of Xcode Command Line Tools):

```bash
xcode-select --install   # one-time, if not already installed
npm run build:capture    # compiles → electron/resources/mac/sonorus-capture
```

`npm run build:mac` calls this step automatically.

Windows system audio uses a C++ WASAPI loopback helper built from `native/windows/sonorus-capture/main.cpp`:

```bash
npm run build:capture:win   # compiles → electron/resources/win/sonorus-capture.exe
```

`scripts/build-capture-win.js` uses MSVC on Windows (Visual Studio Build Tools, C++ workload; static C runtime) and mingw-w64 elsewhere. Without any compiler it keeps a helper already in `electron/resources/win/` that is newer than the source, e.g. one cross-compiled on Linux and copied in. `npm run build:win` calls this step automatically. Linux needs no native binary (`parec`). See [AudioCaptureService](../services/AudioCaptureService.md#sonorus-captureexe--windows-wasapi-helper).

### 3. electron-builder

Packages the Electron app + `backend-dist/` into the final installer:

```bash
npm run build:mac    # build:capture → bundle-backend.js → electron-builder
npm run build:win    # build:capture:win → bundle-backend.js → electron-builder (x64)
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
match `requirements.packaged.txt` and contain no CUDA packages, and that the GPU manifests match the
bundled `torch`.

### GPU manifests

The installers stay CPU-only. GPU acceleration on Linux and Windows is an optional download inside
the app (the CUDA build of PyTorch, [GPU acceleration](../ui/electron/gpu-acceleration.md)), described per platform by `locks/gpu-<platform>-<arch>.json`
(`GPU_TARGETS`: `linux-x64`, `win32-x64`; macOS has no CUDA). `scripts/lock-backend.js` writes them
together with the locks:

1. Switches `requirements.packaged.txt` to the cu128 builds (`+cpu` → `+cu128`, index `whl/cu128`).
2. Resolves it with `uv pip compile --format pylock.toml`, every package except the CUDA family
   (`torch`, `torchaudio`, `torchvision`, `torchcodec`, `triton`, `nvidia-*`) constrained to the
   version in the CPU lock. Without the constraints unrelated packages (e.g. `starlette`) drift to newer
   versions.
3. Keeps only the packages that differ from the CPU lock — on Linux the torch family, `triton` and the
   `nvidia-*-cu12` libraries (≈ 3.9 GB); on Windows `torch`, `torchaudio`, `torchvision`, with the CUDA
   libraries inside the `torch` wheel (≈ 3.5 GB). A package outside the CUDA family fails the script.
4. Writes each package's wheel for the platform: `name`, `version`, `url`, `sha256`, `size` (from the
   lock, else a `HEAD` request).

The manifest also carries `torch` (`2.8.0+cu128`), `base_torch` (the bundled version without the
local tag), `cuda` (`12.8`), `min_driver` (`570`, the oldest NVIDIA driver for CUDA 12.8),
`min_compute_capability` (`7.0`, the oldest GPU the cu128 wheels support) and `total_size`.

---

## Installer size

The bundled libraries make the installers large (Linux AppImage ≈ 1 GB). GitHub Releases refuses
assets over 2 GiB, so every CI build job runs `node scripts/check-installer-size.js dist` after
electron-builder and fails when an installer exceeds **1900 MiB**.

---

## Icons

The app icon has two masters, both 1024×1024 PNG with the S logo on a light plate. They differ only in the
plate size, because the platforms reserve different margins:

| Master | Plate | Used for |
|---|---|---|
| `electron/assets/icon-macos.png` | 824×824, margin 100 (Apple icon grid; the margin holds the shadow) | `build/icons/icon.icns` |
| `electron/assets/icon.png` | 896×896, margin 64, 8 px above centre (room for the shadow) | `build/icons/icon.ico`, Linux AppImage, window icon (`electron/main.js`) |

A macOS icon without the full plate is shrunk by macOS 26 and placed on a grey plate, so the macOS master keeps
the Apple grid exactly. Windows and Linux have no such grid; with the macOS margins the icon would look smaller
than its neighbours.

| File | Purpose |
|---|---|
| `electron/assets/logo.png` | Transparent S logo (1024×1024) — titlebar and favicon inside the app, and the source of both masters |
| `build/icons/icon.icns` | macOS, 16–1024 px (generated) |
| `build/icons/icon.ico` | Windows, 16–256 px (generated) |

Linux takes `icon.png` as is: electron-builder makes the hicolor size set from it.

The masters are drawn in the design file (page "Logo") and exported at 1×. After replacing a master, rebuild
the installer icons and commit them:
```bash
node scripts/build-icons.js
```
The script uses the `png2icons` npm package. `tests/build/app-icons.test.js` checks the plate geometry of both
masters and that `icon.icns` and `icon.ico` were built from them.

---

## Code signing

Current releases are **unsigned**. Users will see:

- **macOS**: Gatekeeper warning → right-click → Open to bypass
- **Windows**: SmartScreen warning → "More info" → "Run anyway"
- **Linux**: no signing required

Code signing requires an Apple Developer account ($99/yr) for macOS notarization and an EV certificate ($300+/yr) for Windows SmartScreen trust.
