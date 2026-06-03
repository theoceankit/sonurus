---
sidebar_position: 98
---

# Known Issues

All open issues in one place.

---

### model.safetensors downloads during first transcription

**Severity:** minor — does not affect correctness; adds ~1.26 GB download on first use of a language.

**Symptom:** after downloading an alignment model via Settings or the in-app popup, the first transcription for that language still shows a background download of `model.safetensors` in the server logs. The transcription completes successfully.

**Cause:** the HuggingFace `Transformers` library (`from_pretrained`) downloads both weight formats the first time a model is loaded: `pytorch_model.bin` (PyTorch) and `model.safetensors` (SafeTensors). Our `snapshot_download` fetches the full repo snapshot, but Transformers still checks for the safetensors file independently and fetches it if absent.

**Impact:** only affects the **first** transcription per language after a fresh alignment model install. On subsequent transcriptions both files are present and no download occurs. The file is written to the correct location (`.models/alignment/`).

**Pending fix:** pre-fetch both formats explicitly during `download_model()`, or suppress the safetensors download via `TRANSFORMERS_OFFLINE=1` after the initial install.

---

### torchcodec warning on macOS

**Severity:** cosmetic — does not affect functionality.

**Symptom:** at server startup, pyannote prints a multi-line warning about `torchcodec` failing to load `libavutil.*.dylib`:

```
UserWarning: torchcodec is not installed correctly so built-in audio decoding will fail.
  Reason: no LC_RPATH's found
```

**Cause:** `torchcodec` (a torchaudio dependency) expects FFmpeg shared libraries at a hardcoded rpath. Homebrew installs FFmpeg at `/opt/homebrew/lib/`, which `torchcodec` does not search.

**Impact:** none. The pipeline loads audio via WhisperX (which calls the `ffmpeg` binary directly) and passes pre-loaded waveform tensors to PyAnnote. `torchcodec`'s own audio decoder is never invoked.

**Suppression:** the warning is hidden when `VERBOSE=false` (default) via `suppress_ml_noise("startup")` in `app/warnings.py`, called from `app/api/main.py` at import time.

**Permanent fix (optional):** set `DYLD_LIBRARY_PATH=/opt/homebrew/lib` before starting the server. This lets `torchcodec` find the FFmpeg dylibs and eliminates the warning at the source.

---

### Packaged app uses CPU-only PyTorch

**Severity:** performance — transcription is significantly slower without GPU.

**Symptom:** in the packaged (installed) app, transcription takes much longer than in dev mode with a CUDA GPU.

**Cause:** `requirements.packaged.txt` installs `torch+cpu` from `download.pytorch.org/whl/cpu`. This is the safe default that works on all hardware, but forgoes CUDA acceleration.

**Impact:** all platforms. macOS is CPU-only regardless (no CUDA support). Windows and Linux users with NVIDIA GPUs are affected.

**Workaround:** manually reinstall PyTorch with CUDA support after the app's first-run setup. See [Setup → GPU acceleration](./environment/setup.md#gpu-acceleration).

**Pending fix:** detect available CUDA version during first-run setup and install the appropriate torch build automatically.

---

### AppImage taskbar icon shows generic icon on GNOME

**Severity:** cosmetic — does not affect functionality.

**Symptom:** when Sonorus is running as an AppImage, the GNOME taskbar shows a generic application icon instead of the Sonorus icon.

**Cause:** AppImages are not installed to the system and have no `.desktop` file registered with GNOME. Without a registered desktop entry, GNOME cannot map the running window to the correct icon.

**Fix:** install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher), which automatically integrates AppImages into the system:
```bash
yay -S appimagelauncher   # Arch/CachyOS
```
After integration, the Sonorus icon appears correctly in the taskbar, app switcher, and dock.

**Note:** this issue does not affect `.deb`/`.rpm` packages or future distribution through system package managers. macOS and Windows builds are unaffected.

---

### macOS system audio shows "Not available"

**Severity:** feature gap — live recording works but cannot capture system/app audio without a third-party tool.

**Symptom:** in the New Recording modal the System Audio dropdown shows "Not available" on a standard macOS install.

**Cause:** macOS blocks system audio capture via the standard `getUserMedia` API for privacy reasons. The dropdown only populates when a virtual loopback device (BlackHole, Loopback) is installed and appears as an audio input with a matching label.

`getDisplayMedia({ audio: true })` was evaluated as an alternative but Electron/Chromium on macOS returns a video-only stream (0 audio tracks). ScreenCaptureKit audio requires native integration deeper than the current WebRTC layer provides.

**Workaround:** install [BlackHole 2ch](https://existential.audio/blackhole/) (free). After installation, the BlackHole device appears in the System Audio dropdown.

**Pending fix:** native ScreenCaptureKit integration via a Node.js native addon or waiting for Electron to expose SCK audio through the standard `getDisplayMedia` path.

---

### Gatekeeper / SmartScreen warnings on unsigned builds

**Severity:** minor UX friction — does not affect functionality.

**Symptom:**
- **macOS:** "Sonorus cannot be opened because it is from an unidentified developer."
- **Windows:** "Windows protected your PC" / SmartScreen warning.

**Cause:** current releases are not code-signed. macOS Gatekeeper and Windows SmartScreen flag unsigned apps from unknown publishers.

**Workaround:**
- macOS: right-click the `.app` → Open → Open (once per install).
- Windows: click "More info" → "Run anyway".

**Permanent fix:** requires Apple Developer Program membership ($99/yr) for macOS notarization and an EV code-signing certificate ($300+/yr) for Windows SmartScreen reputation.
