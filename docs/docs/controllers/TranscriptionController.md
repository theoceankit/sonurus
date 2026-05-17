---
sidebar_position: 1
---

# Transcription Controller

`TranscriptionController` is the business logic layer between services and the CLI. It orchestrates the pipeline, handles user actions on the transcript, and delegates writes to services.

Does not perform ML inference and does not access the database directly — only through services.

---

## Methods

### `run_pipeline(audio_path, on_progress=None) → Transcript`

Runs the full ML pipeline:
1. `TranscriptionService.transcribe()` — ASR + diarization
2. `EmbeddingService.extract_all()` — embeddings in a single pass
3. `SpeakerMemoryService.resolve()` — matches against memory
4. `TranscriptBuilder.build()` — assembles `Transcript`
5. `TranscriptBuilder.attach_embeddings()` — attaches per-segment embeddings

Returns a `Transcript` with status `draft`.

`on_progress` is an optional callback `(step: str) → None` called at each pipeline step (used by the API router to stream progress over WebSocket).

---

### `reassign_speaker(transcript, segment_idx, new_speaker_id)`

Sets `speaker_final` for a single segment.

---

### `reassign_all_by_speaker(transcript, from_speaker, new_speaker_id)`

Sets `speaker_final` for all segments where the effective speaker equals `from_speaker`.

Effective speaker: `speaker_final or speaker_resolved or speaker_raw`.

---

### `create_new_speaker() → str`

Generates a new temporary UUID4 speaker ID.

---

### `get_display_name(spk_id) → str`

Returns the speaker's display name (`display` label from `speaker_names`). If no name is set, returns `spk_id` as-is.

---

### `rename_speaker(spk_id, name, label="display")`

Writes a name to `SpeakerMemoryService.known_names`. Persisted to the database only after `commit()`.

---

### `resolve_display_name_to_id(name) → str | None`

Looks up a speaker by display name in `known_names`. Returns `spk_id` or `None`.

---

### `get_all_known_speakers() → list[tuple[str, str]]`

Returns all known speakers from the database as `[(spk_id, display_name), ...]`.

Used in the CLI to show speakers from past sessions when assigning a segment.

---

### `commit(transcript)`

Calls `CommitService.commit()` and `TranscriptStorageService.save()` — the single write point to the database.
