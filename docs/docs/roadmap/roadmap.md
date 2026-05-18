---
sidebar_position: 1
---

# Roadmap

Target state for the system — what needs to change and why. Organised by area, not by priority or timeline.

For individual open bugs see [Known Issues](../known-issues.md).

---

## Speaker Memory & Recognition

### ✅ Recompute-from-segments embeddings
**Done.** `CommitService` no longer uses incremental averaging. Every commit queries all segments for the affected speaker(s) from the DB and recomputes the mean from scratch. This means:
- Retroactive corrections are reflected immediately — reassigning a segment from A to B removes A's contribution at the next commit for A.
- Auto-recognized speakers' embeddings are updated after each new session via `commit_recognized_speakers()`, called automatically after `POST /transcribe` saves the transcript.
- Per-segment reassign (`PATCH /segments/{start}/speaker`) also triggers immediate embedding recomputation for both affected speakers.
- `SpeakerMemoryService.save()` uses dirty tracking — only writes freshly computed speakers to DB, preventing a stale long-lived instance from overwriting correct values.

`speaker_embeddings.count` now reflects the number of segments used for the last computation (informational only — not used in any averaging logic).

### ✅ Persist per-segment embeddings
**Done.** `TranscriptStorageService.save()` serialises `seg.embedding` to a `BLOB` column in `segments`. `load()` deserialises it back — loaded transcripts have embeddings present, and `CommitService.commit()` works on them the same way as on fresh transcripts.

### Explicit speaker resolution flag
**Current:** RECOGNIZED/UNRECOGNIZED classification is inferred from the ID string (`SPEAKER_` prefix or `spk_` prefix) — a naming convention, not a first-class property.  
**Target:** add `is_resolved: bool` to the `Segment` model and a corresponding column in the `segments` table. Classification becomes explicit and robust to any future ID format.  
See [Domain Invariants → I5](../system/invariants.md#i5--speaker-classification-rule).

### Optimal speaker matching (Hungarian algorithm)
**Current:** greedy matching by descending cosine similarity — correct for 2–5 speakers but not globally optimal when similarity scores are close.  
**Target:** replace with the Hungarian algorithm to guarantee the globally best one-to-one assignment.  
See [Domain Invariants → I6](../system/invariants.md#i6--speaker-matching-is-exclusive-one-to-one).

### Multi-vector speaker profiles (long-term)
**Current:** one averaged embedding vector per speaker — cannot represent voice variation across sessions or acoustic conditions.  
**Target:** store multiple embedding vectors per speaker and use clustering (e.g. k-means) to match new audio against the speaker's voice distribution.  
See [Domain Invariants → I4](../system/invariants.md#i4--commitservice-uses-per-segment-embeddings).

---

## UI — Settings & Model Management

### ✅ Whisper model selection per transcription
**Done.** Import view dropdown lets the user pick any of the 5 Whisper models (tiny → large-v3) before starting transcription. Selection is persisted to `settings.json` and sent as `whisper_model` in `POST /transcribe`. Backend threads it through `service_factory` → `TranscriptionService` constructor.

### ✅ Settings persistence
**Done.** `settings.json` in the project root persists `{ scale, transcribeLang, transcribeModel, exportFormat }` via Electron IPC (`ipcMain` read/write). `loadSettings()` is called on app init; `saveSettings(patch)` is called on any preference change.

### ✅ Model management UI
**Done.** Settings view fetches `GET /models` on open to show real install status. Download (`POST /models/{id}/download`) streams progress and ETA via WebSocket. Delete (`DELETE /models/{id}`) removes the cache directory. Model selection calls `saveSettings`.

### Diarization model management
**Current:** the diarization model row is rendered in Settings UI (download/delete buttons exist) but the `/models` API only covers Whisper models.  
**Target:** extend `ModelService` catalog to support per-model subdirectories (`whisper/` vs `hf/`), add `diarize` entry (`pyannote/speaker-diarization-community-1`, `hf/` subdir), and add `"diarize"` to the router's `Literal` type.  
**Constraint:** the diarization model is gated on HuggingFace — requires `HF_TOKEN` for download, same as the current Whisper flow.

---

## UI — Editor

### Segment action buttons

| Button | Status | Notes |
|---|---|---|
| Edit | ✅ Done | Inline contenteditable; `PATCH /transcripts/{id}/segments/{start}/text`; Enter to save, Escape to cancel |
| Copy | ✅ Done | Copies segment text to clipboard |
| Delete | ✅ Done | `DELETE /transcripts/{id}/segments/{start}`; row fades out |
| Play | Partial | Scrolls segment into view; does not seek audio player to timestamp |
| Bookmark | Pending | Semantics undefined — flag in DB, local list, or other |

### Back button
**Current:** rendered but not connected.  
**Target:** navigate back to `ImportView`.

---

## UI — Import & Progress

### File validation before transcription
**Current:** "Start transcription" is always enabled; clicking without a file falls back to `testdata/output.wav`.  
**Target:** disable the button until a valid file is selected; remove the hardcoded fallback.

### ✅ Pipeline cancellation
**Done.** Cancel button in `ProgressView` sends `DELETE /transcribe/{job_id}`; the API sets a `threading.Event` that raises `_JobCancelled` in the worker thread at the next `on_progress` checkpoint. WebSocket receives a `cancelled` event and the UI returns to `ImportView`.

---

## Architecture

### CommitService as write coordinator
**Current:** `CommitService.commit()` writes synchronously and directly. Works for a single user.  
**Target:** if multi-user support or streaming transcription is added, CommitService should become a write coordinator with a queue or transaction log — still the single entry point for all memory writes.  
See [Domain Invariants → I2](../system/invariants.md#i2--only-commitservicecommit-writes-to-speaker-memory).


### Pending

- Audio playback: Play button on segment seeks player to timestamp
- Bookmark semantics (see Segment action buttons above)
- Electron packaging / distribution build

---

## Open Source

### Setup documentation
A full Getting Started guide: installation, virtual environment, HuggingFace token setup, first run.  
Currently a placeholder at [Setup](../environment/setup.md).
