---
sidebar_position: 2
---

# Domain Invariants

Rules that must always hold. Violating any of these corrupts speaker memory or produces incorrect transcripts.

---

## I1 — `resolve()` is pure

`SpeakerMemoryService.resolve()` returns a `{SPEAKER_XX → id}` mapping and never mutates `known_speakers` or any other stored state.

**Why:** `resolve()` runs before the user has reviewed or confirmed speaker assignments. Writing to memory at this point would corrupt the database with unverified data.

**In code:** `app/services/speaker_memory_service.py` — `resolve()` only reads `self.known_speakers`, never writes to it. `save()` is never called inside `resolve()`.

---

## I2 — Only `CommitService` writes speaker embeddings

No code other than `CommitService` may call `SpeakerMemoryService.update_embedding()` or write to `speaker_embeddings`.

Two permitted exceptions that do not write embeddings:
- `SpeakerMemoryService.save_names_only()` — writes only `speaker_names` (display names). Called from `PATCH /speakers/{id}`, `POST /speakers/{id}/rename` and via `create_named_speaker()` when a user assigns segments to a new name.
- `SpeakerMemoryService.set_color()` — writes only `speaker_meta` (palette color). Called from `PATCH /speakers/{id}` and, with the optional `color_index`, when `PATCH /transcripts/{id}/segments/{start}/speaker` or `POST /transcripts/{id}/reassign` creates a speaker by name.
- `SpeakerMemoryService.remove_speaker()` — deletes a speaker (embedding, names, color) from memory and DB. Called only through `CommitService`: `recompute_or_remove()` drops unnamed speakers left without segments, and `delete_speaker()` (`DELETE /speakers/{id}`) first unassigns the speaker's segments so nothing can recompute the profile back.
- `SpeakerMemoryService.clear()` — deletes every speaker (embeddings, names, colors) and drops the in-memory state. Called only from `POST /data/reset` (full data reset), which runs `TranscriptStorageService.clear()` first, so no segments remain to recompute from.

**Why:** Centralising embedding writes to `CommitService` makes it possible to reason about when and why voice profiles change. Name management and cleanup are deliberately separated from embedding updates.

**In code:** `app/services/commit_service.py` — `commit()`, `commit_speaker()`, and `commit_new_speakers()` are the only paths that call `update_embedding()` + `save()`.

**Target state:** The principle stays. If multi-user support or streaming transcription is added, `CommitService` should become a write coordinator with a queue or transaction log — but it remains the single entry point for embedding writes.

---

## I3 — `speaker_final` always takes priority

The effective speaker for any segment is always resolved as:

```
unassigned ? UNASSIGNED : speaker_final ?? speaker_resolved ?? speaker_raw
```

`unassigned` (set when the segment's speaker is deleted) wins over every speaker field: such a segment has no speaker until the user assigns one, and it never falls back to the unstable `speaker_raw`. `UNASSIGNED` is a pseudo-id — never stored in `segments.speaker_id` and never a speaker in memory.

No code may read `speaker_raw` or `speaker_resolved` as the effective speaker when `speaker_final` is set.

**Why:** `speaker_final` is the explicit user decision. Ignoring it in favour of an automated result would silently undo user corrections.

:::warning[Partial loss after save + load]
`TranscriptStorageService` stores only the effective speaker in the `speaker_id` column at save time. On load, that value is restored into `speaker_resolved` — `speaker_final` is always `None` after loading from the database.

The invariant rule itself is followed (the code always checks `speaker_final` first), but the distinction between "auto-matched" and "user-corrected" is permanently lost after a save/load cycle. See the **Collapsed** state in [State Machines — Segment: Speaker Identity](./state-machine.md#4-segment-speaker-identity).
:::

---

## I4 — `CommitService` recomputes embeddings from all DB segments

Whenever a speaker's embedding is updated, `CommitService` queries **all** segments for that speaker across all transcripts from the database and recomputes the average from scratch using a **centroid-of-centroids** approach:

```
for each transcript:
    centroid = normalise(mean(seg.embedding for segments in that transcript))
speaker_embedding = normalise(mean(centroids))
```

Each recording contributes exactly one centroid regardless of how many segments it contains, so a long recording does not outweigh a short one. An optional similarity guard excludes transcripts whose centroid falls below `SPEAKER_SIMILARITY_THRESHOLD` against the speaker's current stored embedding — this prevents acoustically incompatible recordings from corrupting an otherwise clean profile.

It must never use the aggregated embeddings produced by `EmbeddingService.extract_all()` (the per-`SPEAKER_XX` aggregate, computed before the user has corrected anything), and must never use incremental averaging over previous embedding values.

**Why:** Recomputing from current DB state means:
- Retroactive corrections are reflected immediately: reassigning a segment from A to B removes A's contribution on the next commit for A.
- Auto-recognized speakers are updated after each new session automatically.
- Multiple commit calls are idempotent — the result does not drift.
- Per-transcript equal weighting prevents a many-segment recording from dominating the embedding.
- The similarity guard prevents a misattributed or acoustically incompatible recording from pulling the embedding below the recognition threshold.

**In code:** `app/services/commit_service.py` — `_avg_from_db(speaker_id, guard_emb=None)` is the single averaging kernel; all commit methods call it. `TranscriptStorageService.get_embeddings_grouped_by_transcript(spk_id)` returns `{transcription_id: [embeddings]}`. `commit_speaker()` and `recompute_or_remove()` pass the current stored embedding as `guard_emb`. The aggregated dict from `EmbeddingService.extract_all()` is never passed into `CommitService`; only the per-segment list is used (attached to the transcript via `TranscriptBuilder.attach_embeddings()`).

**Dirty tracking:** `SpeakerMemoryService.save()` only writes to `speaker_embeddings` for speakers marked dirty by `update_embedding()`, and only writes `speaker_names` rows for names changed by `set_name()` on that instance. This prevents a long-lived instance with stale in-memory state (the API singleton or a pipeline job) from overwriting embeddings or names written by another instance.

**Target state:** The principle stays.

---

## I5 — Speaker classification rule

A speaker is **RECOGNIZED** if and only if they have a display name entry in `speaker_names` (label `display`). All others are **UNRECOGNIZED**.

- `SPEAKER_00`, `SPEAKER_01`, … — raw diarization output, always UNRECOGNIZED.
- UUID4 without a name in `speaker_names` — committed to memory but not yet named, UNRECOGNIZED.
- UUID4 with a `display` label in `speaker_names` — RECOGNIZED.

The display name is **never** stored as the speaker ID. All IDs in `speaker_embeddings` and `segments.speaker_id` are UUID4 strings (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

**In the UI:** `isUnrecognized(spkId, knownMap)` in `utils.js` — `knownMap` is built from the named rows of `GET /speakers` (`buildKnownMap()` skips `name: null`). A speaker is unrecognized if absent from `knownMap`, if their ID starts with `SPEAKER_`, or for the `UNASSIGNED` pseudo-id.

**Why:** Decoupling identity (UUID) from display name means renaming a speaker only updates `speaker_names` without touching segment data or embeddings. Display names are not unique: two different people named "Alice" coexist as two UUIDs, and assigning segments to a new name always creates a new UUID. The UI marks speakers that share a name and shows their usage to tell them apart.

**Target state:** The principle stays.

---

## I6 — Speaker matching is exclusive (one-to-one)

During `resolve()`, each known speaker may be matched to at most one new `SPEAKER_XX`, and each `SPEAKER_XX` may be matched to at most one known speaker. Assignments are made greedily by descending cosine similarity score.

**Why:** Without exclusivity, one known speaker could absorb all new speakers, and one new speaker could be split across multiple known identities — both producing nonsensical results.

**In code:** `app/services/speaker_memory_service.py` — `resolve()` maintains `assigned_new` and `assigned_known` sets; any candidate where either side is already taken is skipped.

**Target state:** The principle stays. Greedy assignment is correct for the usual 2–5 speakers but is not globally optimal when similarity scores are close and there are many candidates.
