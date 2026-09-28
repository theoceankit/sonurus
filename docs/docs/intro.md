---
sidebar_position: 1
---

# Introduction

**Sonorus** — a local AI transcription app with persistent speaker identification across sessions.

Transcribes audio, automatically matches speakers against a memory of known voices, lets the user correct results through a desktop UI, and saves updated speaker embeddings for future sessions. All processing is local — no audio leaves the machine.

---

## Stack

| Component | Role |
|---|---|
| [WhisperX](https://github.com/m-bain/whisperX) | ASR + timestamp alignment |
| [PyAnnote](https://github.com/pyannote/pyannote-audio) | Diarisation + speaker embedding extraction |
| FastAPI + uvicorn | REST + WebSocket API server |
| Electron + Vanilla JS | Desktop UI (macOS, Windows, Linux) |
| PyTorch | Model inference |
| NumPy / scikit-learn | Embedding operations, cosine similarity |
| SQLite | Speaker memory and transcript storage |

---

## Entry points

| Command | Description |
|---|---|
| `npm start` | Electron app — starts the FastAPI backend automatically |
| `.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000` | Start backend manually (dev only; do not add `--reload`) |

In the packaged app and in `npm start`, the backend lifecycle is managed by `electron/backend.js` — no manual server start is needed.

---

## Pipeline

```
copy imported audio → transcribe → extract_all → resolve → build → attach_embeddings → [review] → commit → save
```

| Step | Service | Description |
|---|---|---|
| 0 | `audio_store.import_audio()` | Copies an imported file into `$SONORUS_DATA_DIR/recordings/` so the transcript does not depend on the original |
| 1 | `TranscriptionService` | WhisperX ASR + alignment + diarisation |
| 2 | `EmbeddingService.extract_all()` | Single PyAnnote pass: aggregated embeddings per `SPEAKER_XX` + per-segment embeddings |
| 3 | `SpeakerMemoryService.resolve()` | Cosine similarity matching against known speakers — pure function, no writes |
| 4 | `TranscriptBuilder.build()` | Assembles `Transcript` from raw ML output |
| 5 | `TranscriptBuilder.attach_embeddings()` | Attaches per-segment embeddings via overlap matching |
| 6 | Review | Transcript editor + speaker reassignment |
| 7 | `CommitService.commit()` | Aggregates embeddings by final speaker, updates `speaker_memory.db` |
| 8 | `TranscriptStorageService.save()` | Persists transcript and segments to SQLite |

Every import and live recording becomes a job in the **transcription queue** ([Transcription Queue](services/TranscriptionQueue.md)): jobs are persisted and run one at a time in the background, and the queue can be paused, reordered and retried. Steps 1–5 run in a child process that is stopped at once when the queue pauses ([Pipeline Process](services/PipelineProcess.md)); saving and speaker commits happen in the backend.

---

## Speaker identification

Each segment carries three speaker fields in priority order:

| Field | Source | Stable |
|---|---|---|
| `speaker_raw` | Diarisation output (`SPEAKER_00`, `SPEAKER_01`, …) | No |
| `speaker_resolved` | Auto-matched from memory via cosine similarity | Yes, if similarity ≥ 0.75 |
| `speaker_final` | User correction in UI | Yes — always wins |

Unrecognised speakers get a UUID4 as their ID. Display names are stored separately in `speaker_names`.

---

## Speaker memory

Stored in `speaker_memory.db` (SQLite, location: `$SONORUS_DATA_DIR`):

| Table | Contents |
|---|---|
| `speaker_embeddings` | Speaker ID + embedding vector (float32 BLOB) |
| `speaker_names` | Display names by label (`display`, …) |
| `transcriptions` | One row per pipeline run |
| `segments` | All transcript segments |
| `transcription_jobs`, `transcription_queue_settings` | The transcription queue and its start mode |

---

## Architecture rules

1. **`resolve()` is a pure function** — returns a `SPEAKER_XX → id` mapping, never writes to memory.
2. **Only `CommitService.commit()` writes to speaker memory** — no other code calls `save()`.
3. **`speaker_final` always wins** over `speaker_resolved` and `speaker_raw`.

---

## Quick start (dev)

```bash
# Install Python deps (PyTorch separately — see environment/setup.md)
python -m venv .venv && .venv/bin/pip install -r requirements.txt

# Start the app (backend starts automatically)
npm ci && npm start
```

Set your HuggingFace token in **Settings → API Keys** on first run. See [Setup](./environment/setup.md) for the full guide.
