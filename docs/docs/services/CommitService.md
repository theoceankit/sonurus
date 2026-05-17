---
sidebar_position: 3
---

# Commit Service

`CommitService` is the only service that writes to speaker memory.

It recomputes speaker embeddings from all segments stored in the database and updates `speaker_memory.db`.

---

## Position in the pipeline

```
User review (speaker_final set by user or via reassign)
    ↓
CommitService.commit(transcript)
    ↓ queries all DB segments per speaker
    ↓ averages embeddings
    memory.update_embedding()
    ↓ marks speaker dirty
    memory.save()
    ↓
speaker_embeddings updated
```

---

## Why CommitService is the only write point

Any other code writing to `known_speakers` or calling `memory.save()` violates the architectural contract:

- `resolve()` must remain a pure function
- Only after user review is the final speaker assignment known

Two permitted exceptions that do not write embeddings:
- `SpeakerMemoryService.save_names_only()` — writes only `speaker_names`. Called from `POST /speakers/{id}/rename`.
- `SpeakerMemoryService.remove_speaker()` — deletes a temporary speaker after reassignment.

---

## Methods

### `__init__(memory_service, storage_service)`

```python
commit_service = CommitService(memory_service, storage_service)
```

Requires both services: `SpeakerMemoryService` for writing embeddings, `TranscriptStorageService` for reading all segments.

---

### `commit(transcript)`

Recomputes embeddings for all speakers present in the transcript.

For each speaker, queries **all** their segments across **all** transcripts in the database:

```python
embeddings = storage.get_embeddings_by_speaker(spk_id)
avg = normalise(mean(embeddings))
memory.update_embedding(spk_id, avg, count)
```

Calls `memory.save()` only if at least one speaker was updated.

---

### `commit_speaker(speaker_id)`

Recomputes embedding for a single speaker from all their DB segments.

Called from `POST /transcripts/{id}/reassign` to avoid re-counting all speakers on every reassign call.

---

### `commit_new_speakers(transcript)`

Commits embeddings for speakers in the transcript that are **not yet in memory**.

---

### `commit_recognized_speakers(transcript)`

Updates embeddings for speakers that **already exist in memory** (auto-recognized in a new session).

---

### `recompute_or_remove(speaker_id)`

After a reassignment, recomputes the source speaker's embedding from remaining DB segments. If no segments remain and the speaker has no display name, removes them from memory entirely.

---

## What `commit()` does not do

- Does not read audio
- Does not call ML models
- Does not modify `speaker_raw` or `speaker_resolved`
- Does not create new IDs — only uses IDs already present in segments
