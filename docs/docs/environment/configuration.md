---
sidebar_position: 2
---

# .env Configuration

The app is configured via a `.env` file in the project root. Copy `.env.example` and fill in the values.

```env
HF_TOKEN=your_huggingface_token
VERBOSE=false

# macOS only — see SSL section below
# SSL_CERT_FILE=...
# REQUESTS_CA_BUNDLE=...
```

---

## HF_TOKEN

HuggingFace token used to download gated PyAnnote models. Required on first run.

The token is loaded via `load_dotenv()` in `app/api/main.py` (API path) and `main.py` (CLI path) and written into `os.environ`, where HuggingFace Hub picks it up automatically.

---

## VERBOSE flag

Controls suppression of noisy diagnostic output from ML libraries. Defaults to `false`.

When `VERBOSE=false`, suppression happens in two layers:

### 1. Import-time warnings (API entry point)

`app/api/main.py` sets `warnings.filterwarnings("ignore", module="pyannote")` before importing local modules, which triggers the pyannote import chain. This suppresses warnings emitted when the module is first loaded (e.g. the torchcodec warning on macOS).

### 2. Runtime warnings (inference thread)

`app/api/routers/transcription.py` → `_suppress_noise()` is called at the start of `_run()` inside the `ThreadPoolExecutor` thread. This suppresses warnings emitted during the ML pipeline.

Loggers suppressed at runtime:
```
whisperx, whisperx.asr, whisperx.vads.pyannote, whisperx.diarize
lightning, lightning.pytorch, lightning.fabric
lightning.fabric.utilities.rank_zero
lightning.pytorch.utilities.upgrade_checkpoint
pytorch_lightning
```

> **Note:** Warning suppression is currently spread across three locations (`main.py`, `app/api/main.py`, `app/api/routers/transcription.py`). Consolidating it into a single utility is tracked in [Architecture Improvements](../roadmap/architecture-improvements.md).

---

## When to set VERBOSE=true

- Debugging transcription or diarisation issues
- Understanding which models are loaded and with what parameters
- Diagnosing PyAnnote / WhisperX / Lightning errors

---

## macOS SSL fix

On macOS, Python installed outside of Homebrew may not trust system CA certificates, which causes NLTK downloads to fail with `SSL: CERTIFICATE_VERIFY_FAILED` during the alignment step.

**Fix:** point Python's SSL stack at the `certifi` CA bundle shipped in the venv.

1. Get the path to the bundle:
   ```bash
   .venv/bin/python -c "import certifi; print(certifi.where())"
   ```

2. Add to `.env`:
   ```env
   SSL_CERT_FILE=/path/to/.venv/lib/python3.11/site-packages/certifi/cacert.pem
   REQUESTS_CA_BUNDLE=/path/to/.venv/lib/python3.11/site-packages/certifi/cacert.pem
   ```

These variables are picked up by `load_dotenv()` at server startup — no manual export needed.

---

## File map

```
.env                              ← runtime configuration
.env.example                      ← template with all supported variables
main.py                           ← load_dotenv() + warning suppression (CLI)
app/api/main.py                   ← load_dotenv() + import-time warning suppression (API)
app/api/routers/transcription.py  ← _suppress_noise() inside ThreadPoolExecutor thread (API)
```
