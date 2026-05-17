---
sidebar_position: 2
---

# .env Configuration

The app is configured via a `.env` file in the project root.

```env
HF_TOKEN=your_huggingface_token
VERBOSE=false
```

---

## VERBOSE flag

Controls suppression of noisy diagnostic output from ML libraries. Defaults to `false`.

When `VERBOSE=false`, two layers of noise are suppressed:

### 1. Python warnings and ML library logs

Applied independently in two entry points — ML libraries are imported at call time inside the worker thread, so suppression must be re-applied there.

| Location | What it does |
|---|---|
| `main.py` | `warnings.filterwarnings("ignore")` + `logging.setLevel(ERROR)` at process start (CLI) |
| `app/api/routers/transcription.py` → `_suppress_noise()` | Same — called at the start of `_run()` inside the `ThreadPoolExecutor` thread (Electron/API path) |

Loggers suppressed:
```
whisperx, whisperx.asr, whisperx.vads.pyannote, whisperx.diarize
lightning, lightning.pytorch, lightning.fabric
lightning.fabric.utilities.rank_zero
lightning.pytorch.utilities.upgrade_checkpoint
pytorch_lightning
```
Child loggers with these prefixes are also suppressed (via `logging.root.manager.loggerDict`).

---

## When to set VERBOSE=true

- Debugging transcription or diarisation issues
- Understanding which models are loaded and with what parameters
- Diagnosing PyAnnote / WhisperX / Lightning errors

---

## File map

```
.env                              ← VERBOSE=false
main.py                           ← _suppress_noise equivalent at process start (CLI)
app/api/routers/transcription.py  ← _suppress_noise() called inside ThreadPoolExecutor thread (API/Electron)
```
