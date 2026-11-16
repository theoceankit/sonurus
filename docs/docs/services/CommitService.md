---
sidebar_position: 3
---

# Commit Service

`CommitService` is the only service that writes to speaker memory.

It recomputes speaker embeddings from all segments stored in the database and updates `speaker_memory.db`.

---

## Position in the pipeline

```
User review (speaker assigned in the editor)
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

Permitted exceptions that do not write embeddings:
- `SpeakerMemoryService.save_names_only()` — writes only `speaker_names`. Called from `PATCH /speakers/{id}`, `POST /speakers/{id}/rename` and via `create_named_speaker()` when segments are assigned to a new name or a speaker is created with `POST /speakers`.
- `SpeakerMemoryService.set_color()` — writes only `speaker_meta`. Called from `PATCH /speakers/{id}` and when an assign endpoint creates a speaker by name with `color_index`.
- `SpeakerMemoryService.set_handle()` and the handle `save_names_only()` makes from a new name — write only `speaker_meta`. Called from `PATCH /speakers/{id}`, `POST /speakers/{id}/rename` and when a speaker is created by name.
- `SpeakerMemoryService.remove_speaker()` — deletes a speaker's profile, names, color and handle; called only through `CommitService` (`recompute_or_remove()`, `delete_speaker()`, `merge_speaker()`).
- `SpeakerMemoryService.take_identity()` — moves one speaker's names, colour, handle and photo to another; writes only `speaker_names` and `speaker_meta`. Called only by `merge_speaker()`.
- `SpeakerMemoryService.clear()` — full data reset (`POST /data/reset`).

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
grouped = storage.get_embeddings_grouped_by_transcript(spk_id)  # {transcription_id: [emb]}
avg = normalise(mean(normalise(mean(embs)) for embs in grouped.values()))
memory.update_embedding(spk_id, avg, count)
```

Not called by any API endpoint (the former `POST /transcripts/{id}/commit` was removed); speaker memory is updated by the targeted methods below after each pipeline run and each reassignment.

Calls `memory.save()` only if at least one speaker was updated.

---

### `commit_speaker(speaker_id)`

Recomputes embedding for a single speaker from all their DB segments.

Called from `POST /transcripts/{id}/speaker-assignments` for the speaker the segments go to, so an assignment does not re-count every speaker, and from `PATCH /speakers/{id}` with a `name`, so a voice no job recognized becomes recognizable once it is named in the Speakers window.

---

### `commit_recognized_speakers(transcript)`

Updates embeddings for speakers that **already exist in memory** (auto-recognized in a new session).

---

### `recompute_or_remove(speaker_id)`

After a reassignment, recomputes the source speaker's embedding from remaining DB segments. If no segments remain and the speaker has no display name, removes them from memory entirely. No-op for raw `SPEAKER_*` labels and the `UNASSIGNED` pseudo-id.

---

### `delete_speaker(speaker_id) → dict`

Deletes a speaker (`DELETE /speakers/{id}`): first `storage.unassign_speaker()` detaches all its segments (they become unassigned and no longer feed any profile), then `memory.remove_speaker()` drops its embedding, names and color. Returns `{"segments": n, "transcripts": m}`. The order matters — with segments still assigned, a later recompute could rebuild the profile.

---

### `merge_speaker(from_id, into_id) → dict`

Merges two speakers who turned out to be one person (`POST /speakers/{id}/merge`):

1. `storage.move_speaker()` gives every segment of `from_id` to `into_id`, in every transcript, with its possible matches (`speaker_matches`): where both were matched in one transcript, one row stays, with the higher score, confirmed if either was.
2. When `into_id` has no name and `from_id` has one, `memory.take_identity()` gives `into_id` the names, colour, handle and photo of `from_id` (the same photo file). A named `into_id` keeps all of theirs.
3. `memory.remove_speaker(from_id)` removes what is left of `from_id`: its profile and, when `into_id` was named, its names, colour, handle (now free) and photo (the file too).
4. `into_id`'s embedding is recomputed from all their segments with `_avg_from_db()` **without the guard**. The two speakers were apart because their voices scored below the threshold, so the guard would drop exactly the recordings the merge is for; the user has said the voices are one. With no embeddings at all, `into_id`'s profile is left as it is.

Returns the moved `{"segments": n, "transcripts": m}`. The transcript rows and speaker memory are written by separate connections, not in one transaction: a failure between them leaves `from_id` with no segments, and merging again finishes the job.

---

## What `commit()` does not do

- Does not read audio
- Does not call ML models
- Does not modify `speaker_raw` or `speaker_resolved`
- Does not create new IDs — only uses IDs already present in segments
