---
sidebar_position: 4
---

# Dependencies

Complete list of project dependencies — ML models, Python packages, and system requirements. Maintained to track distribution concerns (licensing, gated models, model weights size).

---

## ML Models

All models are downloaded via HuggingFace Hub and cached in `~/.cache/huggingface/hub/` on first run.

| Model | HuggingFace ID | Size | License | Access |
|---|---|---|---|---|
| Whisper large-v3 (CTranslate2) | `Systran/faster-whisper-large-v3` | ~3.1 GB | MIT | Public |
| Speaker Diarization | `pyannote/speaker-diarization-community-1` | ~100 MB | MIT | **Gated** — requires HF_TOKEN |
| Speaker Embedding | `pyannote/embedding` | ~70 MB | MIT | **Gated** — requires HF_TOKEN |
| Voice Activity Detection | `pyannote/segmentation` | ~20 MB | MIT | **Gated** — requires HF_TOKEN |
| Alignment EN (torchaudio) | `WAV2VEC2_ASR_BASE_960H` | ~360 MB | MIT | Public (torchaudio) |
| Alignment RU | `jonatasgrosman/wav2vec2-large-xlsr-53-russian` | ~1.2 GB | Apache 2.0 | Public |

> Alignment models are loaded dynamically based on the detected audio language. Full language list: `whisperx/alignment.py` → `DEFAULT_ALIGN_MODELS_HF`.

### Gated PyAnnote Models

The three PyAnnote models require:
1. A registered account at [huggingface.co](https://huggingface.co)
2. Accepting the terms of use on each model's page
3. A valid `HF_TOKEN` in `.env`

Without a token, loading will fail with `401 Unauthorized`.

---

## Python Packages

### Pipeline Core

| Package | Version | Role |
|---|---|---|
| `whisperx` | 3.8.5 | ASR pipeline — wrapper around faster-whisper + PyAnnote |
| `faster-whisper` | 1.2.1 | Fast Whisper inference via CTranslate2 |
| `ctranslate2` | 4.7.1 | Quantized inference engine |
| `pyannote-audio` | 4.0.4 | Speaker diarization and embedding extraction |
| `torch` | 2.8.0 | Model inference — CPU and CUDA |
| `torchaudio` | 2.8.0 | Alignment models for EN/FR/DE/ES/IT |
| `transformers` | 4.57.6 | HuggingFace alignment model loading |

### Data and Math

| Package | Version | Role |
|---|---|---|
| `numpy` | 2.4.4 | Embedding operations, audio arrays |
| `scipy` | 1.17.1 | Supporting computations |
| `scikit-learn` | 1.8.0 | Cosine similarity for speaker matching |

### PyAnnote Ecosystem

| Package | Version |
|---|---|
| `pyannote-core` | 6.0.1 |
| `pyannote-database` | 6.1.1 |
| `pyannote-metrics` | 4.0.0 |
| `pyannote-pipeline` | 4.0.0 |
| `pytorch-lightning` | 2.6.1 |
| `pytorch-metric-learning` | 2.9.0 |

---

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| Python | 3.11 | 3.11 |
| RAM | 8 GB | 16 GB |
| VRAM (GPU) | — | 8 GB (CUDA) |
| Disk (models) | 5 GB | 10 GB (all alignment models cached) |
| CUDA | — | 12.x |

On CPU, Whisper runs with `int8` quantization. On CUDA — `int8_float16`.

---

## Licenses and Distribution

| Component | License | Notes |
|---|---|---|
| OpenAI Whisper (weights) | MIT | No restrictions |
| Systran/faster-whisper-* (weights) | MIT | No restrictions |
| PyAnnote (code) | MIT | No restrictions |
| PyAnnote (weights) | [pyannote/licensing](https://github.com/pyannote/pyannote-audio/blob/develop/LICENSE.txt) | HuggingFace registration required |
| PyTorch | BSD-style | No restrictions |

> **Distribution note:** PyAnnote weights cannot be redistributed directly — they must be downloaded per-user through HuggingFace Hub with an individual token. This is the key constraint for any offline distribution scenario.
