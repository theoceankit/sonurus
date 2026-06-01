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
