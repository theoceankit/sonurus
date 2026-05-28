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
- `SpeakerMemoryService.save_names_only()` — writes only `speaker_names` (display names). Called from `POST /speakers/{id}/rename`.
- `SpeakerMemoryService.remove_speaker()` — deletes a speaker from memory and DB. Called from `POST /transcripts/{id}/reassign` to clean up replaced temporary IDs.

**Why:** Centralising embedding writes to `CommitService` makes it possible to reason about when and why voice profiles change. Name management and cleanup are deliberately separated from embedding updates.

**In code:** `app/services/commit_service.py` — `commit()`, `commit_speaker()`, and `commit_new_speakers()` are the only paths that call `update_embedding()` + `save()`.

**Target state:** The principle stays. If multi-user support or streaming transcription is added, `CommitService` should become a write coordinator with a queue or transaction log — but it remains the single entry point for embedding writes.

---

## I3 — `speaker_final` always takes priority

The effective speaker for any segment is always resolved as:

```
speaker_final ?? speaker_resolved ?? speaker_raw
```

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

It must never use the aggregated embeddings produced by `EmbeddingService.extract()` (computed per `SPEAKER_XX` before the user has corrected anything), and must never use incremental averaging over previous embedding values.

**Why:** Recomputing from current DB state means:
- Retroactive corrections are reflected immediately: reassigning a segment from A to B removes A's contribution on the next commit for A.
- Auto-recognized speakers are updated after each new session automatically.
- Multiple commit calls are idempotent — the result does not drift.
- Per-transcript equal weighting prevents a many-segment recording from dominating the embedding.
- The similarity guard prevents a misattributed or acoustically incompatible recording from pulling the embedding below the recognition threshold.

**In code:** `app/services/commit_service.py` — `_avg_from_db(speaker_id, guard_emb=None)` is the single averaging kernel; all commit methods call it. `TranscriptStorageService.get_embeddings_grouped_by_transcript(spk_id)` returns `{transcription_id: [embeddings]}`. `commit_speaker()` and `recompute_or_remove()` pass the current stored embedding as `guard_emb`. `EmbeddingService.extract()` output is never passed into `CommitService`.

**Dirty tracking:** `SpeakerMemoryService.save()` only writes to `speaker_embeddings` for speakers marked dirty by `update_embedding()`. This prevents a long-lived API server instance with stale in-memory state from overwriting embeddings computed by a concurrent pipeline instance.

**Target state:** The principle stays. Further improvement: store multiple embedding vectors per speaker and use clustering instead of a single averaged vector, which would better handle voice variation across sessions.

---

## I5 — Speaker classification rule

A speaker is **RECOGNIZED** if and only if they have a display name entry in `speaker_names` (label `display`). All others are **UNRECOGNIZED**.

- `SPEAKER_00`, `SPEAKER_01`, … — raw diarization output, always UNRECOGNIZED.
- UUID4 without a name in `speaker_names` — committed to memory but not yet named, UNRECOGNIZED.
- UUID4 with a `display` label in `speaker_names` — RECOGNIZED.

The display name is **never** stored as the speaker ID. All IDs in `speaker_embeddings` and `segments.speaker_id` are UUID4 strings (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

**In the UI:** `isUnrecognized(spkId, knownMap)` in `utils.js` — `knownMap` is built from `GET /speakers` (which only returns recognized speakers). A speaker is unrecognized if absent from `knownMap` or if their ID starts with `SPEAKER_`.

**Why:** Decoupling identity (UUID) from display name allows two speakers with the same name (e.g. two people named "Alice") to coexist as distinct UUIDs. Renaming a speaker only updates `speaker_names` without touching segment data or embeddings.

**Target state:** The principle stays. The remaining improvement is to replace the string-prefix fallback in `isUnrecognized()` with a single authoritative check against `knownMap` in all code paths.

---

## I6 — Speaker matching is exclusive (one-to-one)

During `resolve()`, each known speaker may be matched to at most one new `SPEAKER_XX`, and each `SPEAKER_XX` may be matched to at most one known speaker. Assignments are made greedily by descending cosine similarity score.

**Why:** Without exclusivity, one known speaker could absorb all new speakers, and one new speaker could be split across multiple known identities — both producing nonsensical results.

**In code:** `app/services/speaker_memory_service.py` — `resolve()` maintains `assigned_new` and `assigned_known` sets; any candidate where either side is already taken is skipped.

**Target state:** The one-to-one exclusivity invariant stays. Replace the greedy algorithm with the Hungarian algorithm (optimal assignment) to guarantee the globally best matching — not just the locally best. The greedy approach produces correct results for 2–5 speakers but can make suboptimal choices when similarity scores are close and there are many candidates.
