---
sidebar_position: 1
---

# Introduction

**Speaker-Aware Transcription System** — an audio transcription pipeline with persistent speaker identification across sessions.

The system transcribes audio, automatically matches speakers against a memory of known voices, lets the user correct results through a GUI or CLI, and saves the updated speaker embeddings for future sessions.

---

## Stack

| Component | Role |
|---|---|
| [WhisperX](https://github.com/m-bain/whisperX) | ASR + timestamp alignment |
| [PyAnnote](https://github.com/pyannote/pyannote-audio) | Diarisation + speaker embedding extraction |
| FastAPI + uvicorn | REST + WebSocket API server (primary interface) |
| Electron + Vanilla JS | Desktop UI (cross-platform: macOS, Linux, Windows) |
| PyTorch | Model inference |
| NumPy / scikit-learn | Embedding operations, cosine similarity |
| SQLite | Speaker memory and transcript storage |

---

## Entry points

| File | Description |
|---|---|
| `npm start` | Electron app — connects to the FastAPI server |
| `.venv/bin/uvicorn app.api.main:app --reload --port 8000` | FastAPI server — start before Electron |
| `main.py` | CLI — interactive pipeline in the terminal |

---

## Pipeline

```
transcribe → extract_all → resolve → build → attach_embeddings → [review] → commit → save → archive
```

| Step | Service | Description |
|---|---|---|
| 1 | `TranscriptionService` | WhisperX ASR + alignment + diarisation |
| 2 | `EmbeddingService.extract_all()` | Single PyAnnote pass: aggregated embeddings per `SPEAKER_XX` + per-segment embeddings |
| 3 | `SpeakerMemoryService.resolve()` | Cosine similarity matching against known speakers — pure function, no writes |
| 4 | `TranscriptBuilder.build()` | Assembles `Transcript` from raw ML output |
| 5 | `TranscriptBuilder.attach_embeddings()` | Attaches per-segment embeddings to segments via overlap matching |
| 6 | Review | Electron: transcript editor + speaker reassignment. CLI: interactive menu |
| 7 | `CommitService.commit()` | Aggregates embeddings by final speaker, updates `speaker_memory.db` |
| 8 | `TranscriptStorageService.save()` | Persists transcript and segments to SQLite |
| 9 | `ArchiveService.archive()` | Copies audio + saves `.txt` transcript to `.files/YYYY-MM-DD/<stem>/` |

---

## Speaker identification

Each segment carries three speaker fields in priority order:

| Field | Source | Stable across sessions |
|---|---|---|
| `speaker_raw` | Diarisation output (`SPEAKER_00`, `SPEAKER_01`, …) | No |
| `speaker_resolved` | Auto-matched from memory via cosine similarity | Yes, if similarity ≥ 0.75 |
| `speaker_final` | User correction in UI or CLI | Yes — always wins |

Unrecognised speakers get a UUID4 as their ID. Assigning a display name does not change the ID — the name is stored separately in `speaker_names` and the UUID remains the stable identifier. See [State Machines → Segment: Speaker Identity](./system/state-machine.md#4-segment-speaker-identity) for the full lifecycle.

---

## Speaker memory

Stored in `speaker_memory.db` (SQLite):

| Table | Contents |
|---|---|
| `speaker_embeddings` | Speaker ID + embedding vector (float32 BLOB) |
| `speaker_names` | Display names by label (`display`, …) |
| `transcriptions` | One row per pipeline run (audio file, language, status, timestamp) |
| `segments` | All transcript segments linked to a transcription and speaker |

On each `commit()`, the speaker's stored embedding is updated with a weighted running average (all sessions contribute equally) and re-normalised to unit norm.

---

## Architecture rules

Three invariants that must always hold — see [Domain Invariants](./system/invariants.md) for the full list:

1. **`resolve()` is a pure function** — returns a `SPEAKER_XX → id` mapping, never writes to memory.
2. **Only `CommitService.commit()` writes to speaker memory** — no other code calls `save()`.
3. **`speaker_final` always wins** over `speaker_resolved` and `speaker_raw`.

---

## Quick start

Requirements: Python 3.11+, HuggingFace token (for PyAnnote models), CUDA optional.

```env
# .env
HF_TOKEN=your_token_here
VERBOSE=false
```

```bash
# Electron UI (start FastAPI server first)
.venv/bin/uvicorn app.api.main:app --port 8000
npm start

# CLI (audio file must be at testdata/output.wav)
.venv/bin/python main.py
```

See [Configuration](./environment/configuration.md) for details on `VERBOSE` and environment setup.
