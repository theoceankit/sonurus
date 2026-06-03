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

### ✅ Full model pre-download from Settings
**Done.** All three model groups can now be downloaded from Settings before first transcription:

| Group | Models | Cache dir | Settings section |
|---|---|---|---|
| Whisper | tiny / base / small / medium / large-v3 | `.models/whisper/` | ML Models |
| Diarization | `pyannote/speaker-diarization-community-1` + `pyannote/embedding` | `.models/hf/` | ML Models |
| Alignment | 35 languages (wav2vec2 per language) | `.models/alignment/` | Alignment Models |

- `ModelService` unified catalog covers all three groups with `is_installed`, `download`, `delete`, `list`
- `GET /models` returns all 41 entries; `POST/DELETE /models/{id}` handle all types
- Settings → Alignment Models: 35 language rows with flag emoji, native name, size, Download/Cancel/Delete
- `POST /transcribe` returns `400` if Whisper, diarization, or alignment model (explicit language) is not installed
- Auto-detect language: if whisperx detects a language whose alignment model is missing, `AlignmentModelMissingError` is raised and the WS emits `{error_code: "alignment_model_missing", language: "ru"}` — frontend transforms into a download popup with Retry after download completes

**Remaining edge case (low priority):** Transformers `from_pretrained()` downloads both `pytorch_model.bin` and `model.safetensors` formats. Our `snapshot_download` fetches `pytorch_model.bin`, but on first `load_align_model()` call Transformers also fetches `model.safetensors` (~1.26 GB) in the background. Transcription succeeds; the file is only downloaded once.

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

## UI — Live Recording

### System audio capture without virtual devices

**Current state by platform:**

| Platform | Status | Notes |
|---|---|---|
| Windows | ✅ Done (branch `feature/system-audio-capture`) | WASAPI loopback via `setDisplayMediaRequestHandler(audio: 'loopback')` — automatic, no picker |
| macOS | ❌ Not available without BlackHole | See investigation below |
| Linux | ❌ Not available without virtual device | PipeWire Monitor sources don't appear in Electron's `enumerateDevices()` |

**macOS investigation (2026-06-03):** `getDisplayMedia` via Electron/Chromium on macOS returns a video-only stream (0 audio tracks). The `useSystemPicker: true` flag shows Chromium's own screen picker (not the native ScreenCaptureKit picker), which cannot capture system audio. The "Share computer sound" toggle does not appear.

**Why:** Electron's WebRTC layer doesn't expose ScreenCaptureKit audio. The SCK integration for audio is marked experimental in Electron docs and is not functional in Electron 33.

**Options for full cross-platform system audio (requires new work):**

1. **Native Node.js addon (macOS + Linux)** — wrap ScreenCaptureKit (macOS) and PipeWire (Linux) via `node-addon-api`. High effort, correct architecture. Requires native compilation per Electron version.

2. **Python subprocess** — spawn a sidecar process that captures audio using platform APIs (PyObjC + SCK on macOS, `sounddevice` on Linux via PulseAudio Monitor). Medium effort. Backend already running Python; audio is written to a temp file, then transcribed normally. Main risk: PyObjC + SCK on macOS still requires entitlement/signed binary for distribution.

3. **Bundled CLI binary** — ship a small pre-compiled binary (Swift for macOS, Go/Rust for all platforms) that captures system audio and writes to stdout. The Electron main process spawns it. Moderate effort, cleanest user-facing UX.

4. **Wait for Electron** — upstream ScreenCaptureKit audio support is in progress in Chromium/Electron. No timeline.

---

## Open Source

### Setup documentation
A full Getting Started guide: installation, virtual environment, HuggingFace token setup, first run.  
Currently a placeholder at [Setup](../environment/setup.md).
