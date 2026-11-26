---
sidebar_position: 98
---

# Known Issues

All open issues in one place.

---

### Old WhisperX alignment models left on disk

**Severity:** disk space only.

**Symptom:** after an update from 0.3.x, `.models/alignment/` (or `~/.cache/torch/hub/checkpoints/`) may hold a file `wav2vec2_fairseq_base_ls960_asr_ls960.pth` or `wav2vec2_voxpopuli_base_10k_asr_<language>.pt` of about 360 MB each.

**Cause:** earlier versions let WhisperX download its own model for English, French, German, Spanish or Italian during the first job in that language. These languages now use catalog models downloaded in Settings → Languages, and the old files are no longer read.

**Workaround:** delete those files by hand.

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

### A lost recording device is not always noticed

**Severity:** low — the recording goes on, sometimes with silence.

**Symptom:** a microphone unplugged mid-recording on Windows, or one whose capture process exits, stops the recording, saves it and says so. An output device lost on Windows goes on as silence until Stop. On Linux PipeWire may move a recording to another device without a word, or keep the stream open with no audio.

**Cause:** only a capture process that ends by itself tells the backend that a source is gone; the sound server may keep the process running.

**Workaround:** check the device before a long recording; a recording that went silent is still saved up to Stop.

---

### Microphone access asked for the terminal in development on macOS

**Severity:** low — development only.

**Symptom:** with `npm start` from a terminal, macOS asks microphone access for the terminal, not for Sonorus, on the first microphone recording.

**Cause:** the system asks for the app that started the backend, which started the capture helper.

**Workaround:** allow it for the terminal in System Settings → Privacy & Security → Microphone; the packaged app is asked for itself.

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

### Gatekeeper / SmartScreen warnings

**Severity:** minor UX friction — does not affect functionality.

**Symptom:**
- **macOS:** "Sonorus cannot be opened because it is from an unidentified developer."
- **Windows:** "Windows protected your PC" / SmartScreen warning.

**Cause:** releases carry no developer certificate: the macOS app is signed only ad hoc and not notarized, the Windows installer is unsigned. macOS Gatekeeper and Windows SmartScreen flag apps from unknown publishers.

**Workaround:**
- macOS: System Settings → Privacy & Security → **Open Anyway** (older macOS: right-click the `.app` → Open → Open), once per installed version. A `.dmg` built locally is not blocked.
- Windows: click "More info" → "Run anyway".

**Note:** removing the warnings requires signed and notarized builds, which are not set up yet.
