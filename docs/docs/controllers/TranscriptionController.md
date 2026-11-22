---
sidebar_position: 1
---

# Transcription Controller

`TranscriptionController` orchestrates the ML pipeline of a queued transcription job (`POST /queue/jobs`). It is built by `service_factory.create_controller()` together with its services.

Does not perform ML inference itself, does not access the database and never writes speaker memory — saving and committing happen in the queued job (`app/services/transcription_job.py`) after the pipeline returns. Transcript editing (reassigning, renaming, deleting speakers) lives in the API routers and `CommitService`, not here.

---

## Methods

### `__init__(transcription_service, embedding_service, memory_service)`

Keeps references to the three services the pipeline needs.

---

### `analyse(audio_path, on_progress=None, language=None, diarize=True) → dict`

The part of the pipeline that needs the models and reads no speaker memory:
1. `TranscriptionService.transcribe(audio_path, language)` — ASR + alignment + diarization (`language=None` auto-detects)
2. `EmbeddingService.extract_all()` — aggregated and per-segment embeddings in a single pass

With `diarize=False` only the first step runs, without diarization, and `voices` and `turns` are empty. `create_controller(diarize=False)` makes no `EmbeddingService`, which loads its model from the diarization repo as it is made.

Returns plain data, so the [Pipeline Process](../services/PipelineProcess.md) child can send it back: `{"result": aligned WhisperX result, "voices": {SPEAKER_XX: voice}, "turns": [{start, end, speaker, embedding}]}`.

`on_progress` is an optional callback `(step: str) → None` called at each step (`Transcribing audio…`, `Identifying speakers…`).

---

### `build_transcript(analysis, memory, audio_path) → Transcript`

A module function, run in the backend once the analysis is done, with memory read from the database at that moment — not when the job started, so speakers named, created or recomputed while the job ran are recognized and removed ones are not matched:
1. `SpeakerMemoryService.resolve_with_scores()` — pure matching against memory
2. `TranscriptBuilder.build()` — assembles the `Transcript` (unmatched `SPEAKER_XX` get new UUIDs, `UNKNOWN` segments are unassigned)
3. `TranscriptBuilder.attach_embeddings()` — attaches per-segment embeddings

Returns a `Transcript` with status `draft`.

---

### `run_pipeline(audio_path, on_progress=None, language=None) → Transcript`

`analyse()`, then `build_transcript()` against the controller's own `memory_service`. The quality tests run it; a queued job calls the two steps itself ([Transcription Queue](../services/TranscriptionQueue.md)).

After the transcript is built, the job saves it (`TranscriptStorageService.save()`), updates auto-recognized speakers (`CommitService.commit_recognized_speakers()`), and reloads the API memory singleton. `audio_path` is already the app-owned copy (see [Audio Store](../services/AudioStore.md)).
