---
sidebar_position: 98
---

# Known Issues

All open issues in one place.

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

**Workaround (optional):** set `DYLD_LIBRARY_PATH=/opt/homebrew/lib` before starting the server. This lets `torchcodec` find the FFmpeg dylibs and eliminates the warning at the source.

---

### GPU acceleration on Windows not yet checked on real hardware

**Severity:** unknown — the Windows path is covered by tests and a VM without a GPU only.

**Symptom:** none known. On Linux the download, the self-check and transcription on an NVIDIA GPU were checked on real hardware; on Windows only the section without a GPU (no NVIDIA GPU found) was.

**Cause:** the Windows CUDA build ships the CUDA libraries inside the `torch` wheel; CTranslate2 (faster-whisper) relies on finding them once PyTorch has loaded them.

**Workaround:** if the self-check fails, Settings → GPU acceleration shows "GPU check failed" with the reason and the app keeps transcribing on the CPU; **Remove** frees the space. macOS is CPU-only (no CUDA). See [GPU acceleration](./ui/electron/gpu-acceleration.md).


---

### Dev mode and the packaged app share data

**Severity:** data mix-up on developer machines — does not affect users without a source checkout.

**Symptom:** the packaged app shows transcripts, speakers and models from dev mode (`npm start`), and the other way round.

**Cause:** Electron names the data directory after the app: `productName` in the app's `package.json`, otherwise `name`. `productName` is set only under `build` (read by electron-builder), so both modes use `sonorus` (`~/.config/sonorus`, `~/Library/Application Support/sonorus`, `%APPDATA%\sonorus`). Separately, the app reuses any backend that already answers on port 8000, so a running dev backend serves the packaged app too.

**Workaround:** do not run both at once, and start a packaged build with its own data directory: `--user-data-dir=<dir>` (see the [Build and install](./build-and-install/linux.md#where-things-are) page of your OS).

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

### Gatekeeper / SmartScreen warnings on unsigned builds

**Severity:** minor UX friction — does not affect functionality.

**Symptom:**
- **macOS:** "Sonorus cannot be opened because it is from an unidentified developer."
- **Windows:** "Windows protected your PC" / SmartScreen warning.

**Cause:** current releases are not code-signed. macOS Gatekeeper and Windows SmartScreen flag unsigned apps from unknown publishers.

**Workaround:**
- macOS: System Settings → Privacy & Security → **Open Anyway** (older macOS: right-click the `.app` → Open → Open), once per installed version. A `.dmg` built locally is not blocked.
- Windows: click "More info" → "Run anyway".

**Note:** removing the warnings requires signed and notarized builds, which are not set up yet.
