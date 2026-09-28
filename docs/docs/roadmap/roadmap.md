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
- Auto-recognized speakers' embeddings are updated after each new session via `commit_recognized_speakers()`, called automatically after a queued job saves the transcript.
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
See [Domain Invariants → I4](../system/invariants.md#i4--commitservice-recomputes-embeddings-from-all-db-segments).

---

## UI — Speakers

### ✅ Speakers section
A **Speakers** tab in the sidebar lists every speaker (named, unnamed, segment-only) with search, an All / Named / Unnamed filter and usage statistics. The speaker page renames (several speakers may share a name), recolors, lists the transcripts the speaker appears in, plays a voice sample, and deletes the speaker — its segments become **Unassigned** (transcript schema v5) and can be reassigned in the editor. See [API → Speakers](../api/endpoints.md#speakers) and [Electron UI → Speakers section](../ui/electron/overview.md#speakers-section).

### Merge speakers and full speaker profiles
**Current:** speakers that share a name are only marked; there is no merge for the case when they turn out to be the same person. A speaker has a display name and a color.  
**Target:** merge A → B (move all of A's segments to B, recompute B from the DB, drop A); first name, last name, alias and avatar from the [vision](./vision.md#3-speakers).

---

## UI — Settings & Model Management

### ✅ Whisper model selection per transcription
**Done.** Import view dropdown lets the user pick any of the 5 Whisper models (tiny → large-v3) before starting transcription. Selection is persisted to `settings.json` and sent as `whisper_model` in `POST /queue/jobs`. Backend threads it through `service_factory` → `TranscriptionService` constructor.

### ✅ Settings persistence
**Done.** `settings.json` in Electron `userData` persists user preferences via Electron IPC (`ipcMain` read/write). `loadSettings()` is called on app init; `saveSettings(patch)` is called on any preference change.

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
- `POST /queue/jobs` returns `400` if Whisper, diarization, or alignment model (explicit language) is not installed
- Auto-detect language: if whisperx detects a language whose alignment model is missing, `AlignmentModelMissingError` is raised and the job fails with `error_code: "alignment_model_missing"`, `error_language: "ru"` — frontend transforms into a download popup with Retry after download completes

**Remaining edge case (low priority):** Transformers `from_pretrained()` downloads both `pytorch_model.bin` and `model.safetensors` formats. Our `snapshot_download` fetches `pytorch_model.bin`, but on first `load_align_model()` call Transformers also fetches `model.safetensors` (~1.26 GB) in the background. Transcription succeeds; the file is only downloaded once.

---

## UI — Editor

### Segment action buttons

| Button | Status | Notes |
|---|---|---|
| Edit | ✅ Done | Inline contenteditable; `PATCH /transcripts/{id}/segments/{start}/text`; Enter to save, Escape to cancel |
| Copy | ✅ Done | Copies segment text to clipboard |
| Delete | ✅ Done | `DELETE /transcripts/{id}/segments/{start}`; row fades out |
| Play | ✅ Done | Seeks the player to the segment start and plays |
| Bookmark | Pending | Semantics undefined — flag in DB, local list, or other |

### ✅ Transcript title
**Done.** Click the editor title to rename the transcript (`PATCH /transcripts/{id}`). See [Electron UI → Renaming a transcript](../ui/electron/overview.md#renaming-a-transcript).

### ✅ Back button
**Done.** The titlebar back button returns to the home view (`app.showHome()`).

---

## UI — Import & Progress

### ✅ File validation before transcription
**Done.** Import goes through the native file dialog or drag-and-drop (window or `new-recording-modal.js`), so a file is always selected; dropped files are filtered by extension (`isSupportedAudio()`, same list as the dialog filter); `POST /queue/jobs` returns `400` if `audio_path` does not exist or is not readable.

### ✅ Drop files to transcribe
**Done.** Audio files dropped on the home view or the editor are queued right away with the model and language from Settings; several files are queued in drop order. Settings and Speakers ignore drops; during a live recording dropped files are queued and wait (the recording pauses the queue). See [Electron UI → Dropping files to transcribe](../ui/electron/overview.md#dropping-files-to-transcribe).

### ✅ Controllable transcription queue
**Done.** The pipeline runs in a child process, the queue is persisted and run by the backend ([Transcription Queue](../services/TranscriptionQueue.md), `/queue` API), and the sidebar controls it — Pause / Start, Retry, delete with confirmation, editing a job's title / model / language, drag-and-drop order, start mode in Settings, a recording pauses the queue, drops and imports while recording ([Electron UI → Transcription queue](../ui/electron/overview.md#transcription-queue)). 

Why: transcription can fail, the machine may be needed for other work, and a new recording should not compete with an older transcription. The user controls when the queue runs, can collect recordings and imports first and transcribe them later, and can retry failed jobs without importing again. A paused or interrupted job always starts over — no partial progress is kept.

**Queue**
- The queue as a whole is either **running** or **paused**; Pause and Start apply to the whole queue.
- Pausing interrupts the running job; it runs again from the start when the queue resumes.
- Jobs are reordered by drag and drop.
- The queue (jobs, order, parameters, errors) survives an app restart. If jobs are waiting at start-up (e.g. the app was closed mid-job), the queue comes up paused and waits for a manual Start; the job that was running is run again from the start. With nothing waiting (empty queue, or only failed jobs), the automatic mode starts running right away, so new files are transcribed without pressing Start; the manual mode always waits.

**Start mode (Settings)**
- **Automatic:** adding a job starts the queue unless the user paused it.
- **Manual:** adding a job only appends it; the queue does not start by itself.

**Live recording**
- Starting a recording always pauses the queue and interrupts the running job.
- While recording, drops and imports are allowed; the files are appended to the queue (lifts today's recording block in `dropDecision()`).
- When the recording stops, it is appended to the queue. The queue resumes by itself only in automatic mode and only if the recording was what paused it; a pause set by the user stays.

**Jobs**
- Title, model and language can be edited on every job except the running one.
- A failed job moves to the end of the queue, marked with its error; the queue goes on with the others and skips it. **Retry** turns it back into a regular waiting job at the end of the queue.
- `×` on a job card deletes the job after a confirmation, together with its audio: the live recording, or for an import the copy in `recordings/` (the user's original file is kept). There is no separate cancel — Pause covers it.
- Completion and errors are reported with toasts (see *System notifications* below).

### System notifications
**Pending.** Report finished and failed transcriptions with OS notifications as well as toasts, so long queues can run while the window is hidden.

### Re-transcribe an existing transcript
**Pending.** Run a finished transcript again, e.g. with another model or language. Replaces the existing transcript, so it must be decided what happens to the user's speaker corrections and title. Separate from retrying a failed job in the queue.

### ✅ Background transcription queue
**Done.** Transcription no longer takes over the main panel. Jobs run in the background and are shown as cards in a queue section at the top of the sidebar. Multiple files can be queued while the user continues browsing or editing other transcripts. Now a persistent, controllable queue owned by the backend (see *Controllable transcription queue*); the renderer shows the snapshot from `WS /ws/queue`. On completion: toast + sidebar refresh. `alignment_model_missing` failures surface as a modal with inline download + Retry (`alignment-modal.js`).

### ✅ Pipeline cancellation
**Done, then replaced.** A running job is stopped at once, on any step, by terminating its pipeline child process ([Pipeline Process](../services/PipelineProcess.md)). The old cancel (`×` → `DELETE /transcribe/{job_id}`, job gone) became **Pause** (the job waits and later runs again) and **delete** (`×` with confirmation, the job and its audio are removed).

---

## UI without business logic

Controls that are visible and persisted but do not affect behaviour yet. Each is marked with a `TODO(not implemented)` comment in the renderer. Implement the logic or hide the control before a public release.

| Control | Where | Missing logic |
|---|---|---|
| "Diarize speakers" toggle | New recording modal (`new-recording-modal.js`) | Not sent to `POST /queue/jobs`; the pipeline always diarizes |
| "Save audio file" toggle | New recording modal | Not sent anywhere; the recording is always kept |
| Export format (txt/md/srt/vtt/json), include timestamps/speakers/bookmarks/audio, "duplicate" | Settings → Export (`settings-view.js`) | Titlebar export (`app.js`) always copies plain text scraped from the DOM |
| Sidebar filters "Notes" and "Marked" | Sidebar (`index.html`, `app.js` `_applyFilter`) | API returns no `source` or mark fields — "Notes" is always empty, "Marked" shows all |
| Titlebar search | `#tb-search-btn` | No handler; `_rerenderList(query)` is never called with a query |

---

## Architecture

### CommitService as write coordinator
**Current:** `CommitService.commit()` writes synchronously and directly. Works for a single user.  
**Target:** if multi-user support or streaming transcription is added, CommitService should become a write coordinator with a queue or transaction log — still the single entry point for all memory writes.  
See [Domain Invariants → I2](../system/invariants.md#i2--only-commitservice-writes-speaker-embeddings).


### Pending

- Bookmark semantics (see Segment action buttons above)

---

## UI — Live Recording

### ✅ System audio capture without virtual devices

**Done** (`feature/system-audio-capture`). All platform audio goes through `AudioCaptureService` (Python backend) — zero platform detection in renderer JS.

| Platform | Status | Implementation |
|---|---|---|
| macOS | ✅ Done | `sonorus-capture` Swift binary via ScreenCaptureKit — `npm run build:capture` produces `electron/resources/mac/sonorus-capture` |
| Linux | ✅ Done | `ffmpeg -f pulse -i <monitor_source>` — monitor sources enumerated via `pactl list short sources` |
| Windows | ✅ Done | WASAPI loopback via `setDisplayMediaRequestHandler(audio: 'loopback')` — automatic, no picker |

**macOS note:** Screen Recording permission must be granted once in System Settings → Privacy & Security → Screen Recording. The entitlement `com.apple.security.screen-capture` is already declared in `build/entitlements.mac.plist`.

**Key fix:** SCK audio buffers lack per-sample size metadata — `CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer` fails with `kCMSampleBufferError_BufferHasNoSampleSizes`. The correct API is `CMSampleBufferCopyPCMDataIntoAudioBufferList`.

---

## Open Source

### Setup documentation
A full Getting Started guide: installation, virtual environment, HuggingFace token setup, first run.  
Currently a placeholder at [Setup](../environment/setup.md).
