---
sidebar_position: 1
---

# Transcription Controller

`TranscriptionController` orchestrates the ML pipeline for `POST /transcribe`. It is built by `service_factory.create_controller()` together with its services.

Does not perform ML inference itself, does not access the database and never writes speaker memory — saving and committing happen in the API router (`app/api/routers/transcription.py`) after the pipeline returns. Transcript editing (reassigning, renaming, deleting speakers) lives in the API routers and `CommitService`, not here.

---

## Methods

### `__init__(transcription_service, embedding_service, memory_service)`

Keeps references to the three services the pipeline needs.

---

### `run_pipeline(audio_path, on_progress=None, language=None) → Transcript`

Runs the full ML pipeline:
1. `TranscriptionService.transcribe(audio_path, language)` — ASR + alignment + diarization (`language=None` auto-detects)
2. `EmbeddingService.extract_all()` — aggregated and per-segment embeddings in a single pass
3. `SpeakerMemoryService.resolve()` — pure matching against memory
4. `TranscriptBuilder.build()` — assembles the `Transcript` (unmatched `SPEAKER_XX` get new UUIDs, `UNKNOWN` segments are unassigned)
5. `TranscriptBuilder.attach_embeddings()` — attaches per-segment embeddings

Returns a `Transcript` with status `draft`.

`on_progress` is an optional callback `(step: str) → None` called at each pipeline step (used by the API router to stream progress over WebSocket).

After it returns, the router saves the transcript (`TranscriptStorageService.save()`), updates auto-recognized speakers (`CommitService.commit_recognized_speakers()`), and reloads the API memory singleton. `audio_path` is already the app-owned copy (see [Audio Store](../services/AudioStore.md)).
