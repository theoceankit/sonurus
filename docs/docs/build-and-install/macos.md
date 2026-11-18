---
sidebar_position: 2
---

# macOS

Build the `.dmg` from source, install the app, and remove it again. Installers from
[GitHub Releases](https://github.com/theoceankit/sonurus/releases) are built the same way in CI
([Releasing](../distribution/releasing.md)); with a downloaded `.dmg`, skip to [Install](#install).

---

## Requirements

| | |
|---|---|
| System | Apple Silicon Mac, macOS 14.2 or later (system audio is a Core Audio tap, which needs 14.2; the bundled `onnxruntime` has no wheels before macOS 14) |
| Build tools | Xcode Command Line Tools (`xcode-select --install`, for `swiftc`), `git`, Node.js 22.22.2+ with `npm` (e.g. `brew install node`) |
| Disk | ~10 GB free for the build |
| Network | needed to build (Node packages, Python, Python libraries); the built app starts offline |

No Python installation is needed: the build downloads its own interpreter
(python-build-standalone) and installs every library into it from `locks/packaged-darwin-arm64.txt`.
Intel Macs are not supported.

---

## Build

```bash
git clone https://github.com/theoceankit/sonurus.git
cd sonurus
npm ci
npm run build:mac
```

`build:mac` compiles the `sonorus-capture` binary (system audio via a Core Audio tap, the microphone), runs
`node scripts/bundle-backend.js` (Python + libraries + `app/`, precompiled — see
[Packaging](../distribution/packaging.md)) and then `electron-builder --mac`. The result is
`dist/Sonorus-<version>-arm64.dmg`.

---

## Install

1. Open the `.dmg` and drag **Sonorus** to **Applications**.
2. Start Sonorus from Applications or Launchpad.

The app is not code-signed. A `.dmg` you built yourself opens normally; one downloaded from GitHub
is blocked by Gatekeeper on first launch. Then open **System Settings → Privacy & Security**, find
the message about Sonorus and click **Open Anyway** (on older macOS: right-click the app → Open →
Open). This is needed once per installed version.

---

## First launch

1. The main screen opens right away — there is no setup step.
2. **Settings → API Keys**: enter a HuggingFace token (needed to download the diarization model,
   see [Setup → HuggingFace token](../environment/setup.md#huggingface-token)).
3. **Settings → Models**: download a Whisper model and the diarization model.
4. The first live recording asks for **Microphone** access and, with system audio, for
   **System Audio Recording**. Both are listed under System Settings → Privacy & Security (system
   audio under Screen & System Audio Recording, in its System Audio Recording Only part). A refused
   system audio permission gives no error: the recording is saved with silent system audio, and
   Sonorus says where to allow it ([Live recording](../ui/electron/live-recording.md#system-audio-permission-macos)).
   Screen Recording is not needed.

After that, transcription works offline. It runs on the CPU — macOS has no CUDA, and
WhisperX/ctranslate2 do not use Apple's GPU.

---

## Where things are

| What | Path |
|---|---|
| App | `/Applications/Sonorus.app` |
| Data: models, transcripts, recordings, settings | `~/Library/Application Support/sonorus/` |
| Log | `~/Library/Application Support/sonorus/sonorus.log` |

`npm start` (dev mode) keeps its data apart, in `~/Library/Application Support/sonorus-dev/`. Sonorus does not start while
dev mode or another Sonorus with another data directory runs its backend (both use port 8000): an
error dialog names it — close it first. See [Configuration](../environment/configuration.md#sonorus_data_dir).
To try a build without touching existing data, start it with its own directory:

```bash
/Applications/Sonorus.app/Contents/MacOS/Sonorus --user-data-dir="$HOME/Library/Application Support/sonorus-test"
```

---

## Uninstall

Quit Sonorus and move **Sonorus** from Applications to the Trash, or:

```bash
rm -rf /Applications/Sonorus.app
```

Remove the data as well (models, transcripts, recordings, settings — this cannot be undone):

```bash
rm -rf ~/Library/Application\ Support/sonorus
```

Optionally reset the microphone and system audio permissions granted to the app:

```bash
tccutil reset Microphone com.sonorus.app
tccutil reset AudioCapture com.sonorus.app
```

Earlier versions recorded system audio under Screen Recording; that permission is reset with
`tccutil reset ScreenCapture com.sonorus.app`.

Nothing else is left behind: Python and all libraries live inside `Sonorus.app`.
