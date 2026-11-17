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
- `SpeakerMemoryService.remove_speaker()` — deletes a speaker's profile, names, color and handle; called only through `CommitService` (`recompute_or_remove()`, `release_speaker()`, `delete_speaker()`, `merge_speaker()`).
- `SpeakerMemoryService.take_identity()` — moves one speaker's names, colour, handle and photo to another; writes only `speaker_names` and `speaker_meta`. Called only by `merge_speaker()`.
- `SpeakerMemoryService.clear()` — full data reset (`POST /data/reset`).

A voice the system only guessed (an unconfirmed possible match) is not a final assignment either, so it stays out of the profile until the user confirms it.

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

Recomputes embedding for a single speaker from all their DB segments. With nothing to recompute from the profile stays as it is.

Called from `POST /transcripts/{id}/speaker-assignments` for the speaker the segments go to, so an assignment does not re-count every speaker, and from `PATCH /speakers/{id}` with a `name`, so a voice no job recognized becomes recognizable once it is named in the Speakers window.

---

### `commit_recognized_speakers(transcript)`

Updates embeddings for speakers that **already exist in memory** (auto-recognized in a new session). Called by the queue after a job saves its transcript. A named speaker who is a possible match there (recognized below `POSSIBLE_MATCH_CEILING`) gets nothing from it until the user confirms them: see below.

---

### Possible matches stay out until confirmed

Every recompute (`_avg_from_db()`, used by all methods here) leaves out the transcripts where a named speaker is a possible match not confirmed yet: `storage.matches_of_speaker()` gives their `speaker_matches` rows and `is_possible_match()` (`app/services/speaker_candidates.py`) decides, as the candidates route does. So the guess changes no profile whether the recompute comes from the job, an edit in another recording, a merge or the recompute at startup. Rejecting it means assigning its segments to someone else: they leave the speaker, whose profile never had them. A speaker without a name has nothing to confirm, so their low matches count at once; once named, those recordings wait for review like any other.

---

### `confirm_match(transcript_id, speaker_id, confirmed) → bool`

The user confirms a possible match (`POST /transcripts/{id}/possible-matches/{speaker_id}/confirmed`) or takes the confirmation back (`DELETE`). Sets the flag with `storage.set_match_confirmed()`, then recomputes the speaker as `commit_speaker()` does: a confirmed recording joins the profile, a taken-back one leaves it. With nothing to recompute from the profile stays as it is. Returns `False`, changing nothing, when the speaker was not recognized in that transcript.

---

### Every recompute depends on the database alone

`_avg_from_db()` averages every recording of the speaker (except unconfirmed possible matches, above); the stored profile has no say in which recordings count. Recomputing unchanged data gives the same profile, and a profile built from the wrong recording is rebuilt from the right ones as soon as that recording is given to someone else. A recording far from the others, assigned by hand, moves the profile by its share (one of the speaker's recordings); giving its segments back undoes that.

---

### `recompute_or_remove(speaker_id)`

After a recording or a segment is deleted, recomputes the speaker from what remains. With nothing left, an unnamed speaker is removed from memory entirely; a named one keeps their profile, so deleting a recording does not make the app forget a person. No-op for raw `SPEAKER_*` labels and the `UNASSIGNED` pseudo-id.

---

### `release_speaker(speaker_id, transcript_id, created=False)`

After segments of `transcript_id` were given to another speaker (`POST /transcripts/{id}/speaker-assignments`, and `undo_assignment()` for the speakers who had them before the undo), recomputes the speaker who had them from what remains. With nothing left to compute from, the stored voice was the given-away one, and it goes:

- an unnamed speaker with no segments left, or one the undone assignment created (`created=True`), is removed entirely;
- anyone else loses only the profile (`memory.remove_embedding()`): name, handle, colour and photo stay, and the speaker is recognized again once given segments with a voice.

Segments of an unconfirmed possible match were never in the profile, so giving them away leaves a profile with nothing else to compute from as it is. No-op for raw `SPEAKER_*` labels and the `UNASSIGNED` pseudo-id.

---

### `delete_speaker(speaker_id) → dict`

Deletes a speaker (`DELETE /speakers/{id}`): first `storage.unassign_speaker()` detaches all its segments (they become unassigned and no longer feed any profile), then `memory.remove_speaker()` drops its embedding, names and color. Returns `{"segments": n, "transcripts": m}`. The order matters — with segments still assigned, a later recompute could rebuild the profile.

---

### `recompute_outdated_profiles() → int`

Runs once after an update that changes how voices are averaged or which recordings they are averaged from (the last: no similarity guard against the stored profile). When `memory.voice_averaging()` (`_meta.voice_averaging`) is not `config.VOICE_AVERAGING_ID`, every stored profile is recomputed from the database as `commit_speaker()` does; a profile with nothing left to recompute from stays as it is. Then the mark is written and the number of recomputed profiles returned; otherwise it does nothing and returns 0. Needs no model or audio. The backend calls it at startup, before the queue starts; on an error it logs, leaves the mark unwritten and the next start tries again.

### `merge_speaker(from_id, into_id) → dict`

Merges two speakers who turned out to be one person (`POST /speakers/{id}/merge`):

1. `storage.move_speaker()` gives every segment of `from_id` to `into_id`, in every transcript, with its possible matches (`speaker_matches`): where both were matched in one transcript, one row stays, with the higher score, confirmed if either was.
2. When `into_id` has no name and `from_id` has one, `memory.take_identity()` gives `into_id` the names, colour, handle and photo of `from_id` (the same photo file). A named `into_id` keeps all of theirs.
3. `memory.remove_speaker(from_id)` removes what is left of `from_id`: its profile and, when `into_id` was named, its names, colour, handle (now free) and photo (the file too).
4. `into_id`'s embedding is recomputed from all their segments with `_avg_from_db()`. With no embeddings at all, `into_id`'s profile is left as it is.

Returns the moved `{"segments": n, "transcripts": m}`. The transcript rows and speaker memory are written by separate connections, not in one transaction: a failure between them leaves `from_id` with no segments, and merging again finishes the job.

---

## What `commit()` does not do

- Does not read audio
- Does not call ML models
- Does not modify `speaker_raw` or `speaker_resolved`
- Does not create new IDs — only uses IDs already present in segments
