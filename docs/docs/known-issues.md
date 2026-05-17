---
sidebar_position: 98
---

# Known Issues

All open issues in one place.

---

### torchcodec warning on macOS

**Severity:** cosmetic — does not affect functionality.

**Symptom:** At server startup, pyannote prints a multi-line warning about `torchcodec` failing to load `libavutil.*.dylib`:

```
UserWarning: torchcodec is not installed correctly so built-in audio decoding will fail.
  Reason: no LC_RPATH's found
```

**Cause:** `torchcodec` (a torchaudio dependency) expects FFmpeg shared libraries at a hardcoded rpath. Homebrew installs FFmpeg at `/opt/homebrew/lib/`, which `torchcodec` does not search.

**Impact:** None. The pipeline loads audio via WhisperX (which calls the `ffmpeg` binary directly) and passes pre-loaded waveform tensors to PyAnnote. `torchcodec`'s own audio decoder is never invoked.

**Suppression:** The warning is hidden when `VERBOSE=false` (default) via `warnings.filterwarnings("ignore", module="pyannote")` in `app/api/main.py`.

**Permanent fix (optional):** Set `DYLD_LIBRARY_PATH=/opt/homebrew/lib` before starting the server. This lets `torchcodec` find the FFmpeg dylibs and eliminates the warning at the source.
