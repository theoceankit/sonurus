---
sidebar_position: 1
---

# API Endpoints

FastAPI server (`app/api/main.py`) — start with:

```bash
.venv/bin/uvicorn app.api.main:app --port 8000
```

> **Note:** do not add `--reload`. watchfiles detects `.py` files inside `.models/` (e.g. `eval.py` from downloaded models) and restarts the server mid-download, killing active transcription or download jobs.

Interactive docs available at `http://localhost:8000/docs`.

---

## Audio Capture

Manages live system audio recording sessions. The backend dispatches to the correct platform tool (`sonorus-capture` on macOS, `ffmpeg -f pulse` on Linux, WASAPI on Windows). Mic + system tracks are merged with `ffmpeg amix` when both are present.

### `GET /audio/capture/sources`

Returns available system audio sources for the current platform.

```json
// macOS
[{ "id": "sckit", "label": "System audio (ScreenCaptureKit)" }]

// Linux (PulseAudio monitor sources)
[{ "id": "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", "label": "pci-0000_00_1f.3.analog-stereo (Monitor)" }]

// Windows — always empty: system audio is captured in the renderer
// (WASAPI loopback via setDisplayMediaRequestHandler), not by the backend
[]
```

### `POST /audio/capture/start`

Starts a background capture process. Returns a `job_id` immediately.

```json
// Request (optional)
{ "source_id": "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor" }

// Response 200
{ "job_id": "d63f61eb-d5f6-40e2-a866-edb3aa1f96bb" }
```

`source_id` is optional — omit to use the platform default. Ignored on macOS (always ScreenCaptureKit).

### `POST /audio/capture/stop/{job_id}`

Stops the capture process and returns the path to the recorded WAV file. Optionally merges with a microphone recording.

```json
// Request (optional)
{ "mic_path": "<data-dir>/recordings/sonorus-rec-abc123.webm" }

// Response 200 (with or without mic_path)
{ "file_path": "<data-dir>/recordings/sonorus-rec-d63f61eb.wav" }
```

- `404` — job not found (already stopped or invalid ID)

---

## Transcription

### `POST /transcribe`

Starts the ML pipeline in a background thread. Returns a `job_id` immediately.

```json
// Request
{
  "audio_path": "/absolute/path/to/file.wav",
  "whisper_model": "large-v3",   // optional — omit to use WHISPER_MODEL from config
  "language": "ru",              // optional — omit or null for auto-detection
  "title": "Weekly sync"         // optional — defaults to the audio file name without extension
}

// Response 200
{ "job_id": "d63f61eb-d5f6-40e2-a866-edb3aa1f96bb" }
```

**Pre-flight guards** — return `400` before starting the job:

| Condition | Detail |
|---|---|
| Whisper model not installed | `"Whisper model 'large-v3' is not installed. Download it in Settings."` |
| Diarization model not installed | `"Diarization model is not installed. Download it in Settings."` |
| Explicit language in `ALIGNMENT_CATALOG` and alignment model not installed | `"Alignment model for language 'ru' is not installed. Download it in Settings."` |

**Audio copy** — an imported file (anything outside `$SONORUS_DATA_DIR/recordings/`) is copied to `recordings/sonorus-import-<uuid>.<ext>` before the job is queued, and the transcript references the copy; the original is never touched. A live recording is used as it is. If the copy fails (e.g. no disk space) the request returns `400` (`"Could not copy audio file: …"`) and no job starts. A cancelled or failed job deletes its copy. See [Audio Store](../services/AudioStore.md).

When `language` is `null` (auto-detect), the guard for alignment models cannot fire before the job starts. If the detected language requires an alignment model that is not installed, the pipeline raises `AlignmentModelMissingError` and the WS emits a structured error event (see below).

### `WS /ws/{job_id}`

WebSocket that streams pipeline progress. Connect immediately after `POST /transcribe`.

Closing or losing the socket does **not** cancel the job (cancellation is explicit via `DELETE /transcribe/{job_id}`). The job's event queue stays registered until the job ends, so a client can reconnect and continue receiving events; events consumed by the previous connection are not replayed.

After every job — done, error or cancelled — the worker drops its model references and calls `torch.cuda.empty_cache()`.

```json
// Lifecycle events — sent before any progress
{ "type": "queued" }    // job registered; executor has not started it yet
{ "type": "started" }   // executor picked up the job; pipeline is now running

// Progress events
{ "type": "progress", "step": "Loading models…" }
{ "type": "progress", "step": "Transcribing audio…" }
{ "type": "progress", "step": "Identifying speakers…" }
{ "type": "progress", "step": "Building transcript…" }
{ "type": "progress", "step": "Saving to database…" }

// Terminal events
{ "type": "done",  "transcript_id": 42 }
{ "type": "cancelled" }
{ "type": "error", "message": "CUDA out of memory" }

// Structured error — alignment model missing after auto-detect
// The frontend should offer a download prompt for the given language.
{ "type": "error", "error_code": "alignment_model_missing", "language": "ru" }

// Keep-alive (sent every 10s when pipeline is silent — ignore on client)
{ "type": "heartbeat" }
```

`queued` is emitted synchronously when the job is registered — before the executor starts it. When multiple jobs are submitted simultaneously, all receive `queued` immediately and each gets `started` in turn as the single-threaded executor picks them up. The server sends heartbeats every 10 seconds so the connection stays alive during long model loads.

### `DELETE /transcribe/{job_id}`

Cancels a running transcription job. Sets a `threading.Event` that raises `_JobCancelled` in the worker thread at the next progress checkpoint. The WS receives a `cancelled` event.

- `200 {"cancelled": true}` — cancel signal sent
- `404 {"cancelled": false}` — job not found (already finished or invalid ID)

---

## Models

Manages the local model cache. A repo counts as installed when its HuggingFace cache dir has `refs/main`, no `.sonorus-downloading` marker and no `blobs/*.incomplete` files. `huggingface_hub` writes `refs/main` before fetching any file, so the marker (created before a download, removed after it succeeds) is what distinguishes an interrupted download from a complete one.

Model directories:
- Whisper: `.models/whisper/`
- Diarization + PyAnnote embedding: `.models/hf/`
- Alignment (wav2vec2 per language): `.models/alignment/`

### `GET /models`

Returns the full catalog with install status for every model: 5 Whisper + 1 Diarization + 35 Alignment = 41 entries.

```json
[
  { "id": "tiny",     "installed": false },
  { "id": "base",     "installed": false },
  { "id": "small",    "installed": true  },
  { "id": "medium",   "installed": false },
  { "id": "large-v3", "installed": true  },
  { "id": "diarize",  "installed": true  },
  { "id": "ru",       "installed": true  },
  { "id": "zh",       "installed": false },
  { "id": "ja",       "installed": false }
]
```

### `POST /models/{model_id}/download`

Starts a background download via `huggingface_hub.snapshot_download`. Returns a `job_id` immediately.

Valid `model_id` values:
- Whisper: `tiny`, `base`, `small`, `medium`, `large-v3`
- Diarization: `diarize` (downloads `pyannote/speaker-diarization-community-1` + `pyannote/embedding`)
- Alignment: two-letter language code from `ALIGNMENT_CATALOG` — `ru`, `zh`, `ja`, `ko`, `uk`, `pt`, `ar`, `nl`, `pl`, `hi`, `cs`, `tr`, `hu`, `fi`, `fa`, `el`, `da`, `he`, `vi`, `ur`, `te`, `ca`, `ml`, `no`, `nn`, `sk`, `sl`, `hr`, `ro`, `eu`, `gl`, `ka`, `lv`, `tl`, `sv`

Unknown `model_id` returns `422`.

```json
{ "job_id": "a1b2c3d4-..." }
```

### `DELETE /models/{model_id}/download/{job_id}`

Cancels an in-progress download. Sets a `threading.Event`; each `snapshot_download` runs in a child process, which is terminated immediately, so the transfer stops mid-file. Partial files stay in the cache and a later download resumes them. The WS receives a `cancelled` event.

- `200` — cancel signal sent
- `404` — job not found

### `WS /ws/models/{job_id}`

Streams download progress. Connect immediately after `POST /models/{model_id}/download`. Sends heartbeats every 15 s to keep the connection alive during large downloads.

```json
{ "type": "heartbeat" }
{ "type": "progress", "pct": 47.3 }   // byte-level progress, 0–100
{ "type": "done" }
{ "type": "cancelled" }
{ "type": "error", "message": "..." }
```

`pct` is computed from filesystem polling of the HuggingFace blob directory — reflects actual bytes written to disk.

### `DELETE /models/{model_id}`

Removes the model's HuggingFace cache directory from disk.

- `200 {"deleted": "large-v3"}` — success
- `404` — model is not installed
- `422` — unknown `model_id`

---

## Transcripts

### `GET /transcripts`

Returns all transcripts for the sidebar, newest first.

```json
[
  {
    "id": 1,
    "title": "team_standup",
    "created_at": "2026-05-14T10:30:00",
    "section": "Today",
    "status": "draft",
    "speakers": ["385dbc1d-ec85-4486-9b91-f80b7dfdf1ca"],
    "duration": "14 min"
  }
]
```

`speakers` is a list of speaker UUIDs (may include unrecognized ones without a display name).

### `GET /transcripts/{id}`

Full transcript with segments.

```json
{
  "id": 1,
  "audio_path": "files/team_standup.wav",
  "language": "en",
  "status": "draft",
  "title": "team_standup",
  "segments": [
    {
      "start": 0.0, "end": 4.2, "text": "Good morning everyone.",
      "speaker_raw": "SPEAKER_00",
      "speaker_resolved": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca",
      "speaker_final": null,
      "unassigned": false
    }
  ]
}
```

`speaker_resolved` and `speaker_final` are always UUID4 strings (a diarization speaker with too little speech for a voice profile still gets its own UUID). Display names are resolved separately via `GET /speakers`.

`unassigned: true` marks a segment whose speaker was deleted (`DELETE /speakers/{id}`): both speaker fields are `null` and its effective speaker is the pseudo-id `UNASSIGNED`, not `speaker_raw`. Assigning a speaker to it (single or bulk) clears the flag.

### `PATCH /transcripts/{id}`

```json
{ "title": "Weekly sync" }
```

Renames the transcript. `title` is trimmed and must be 1–200 characters (`422` otherwise). Only transcript metadata changes — segments, speakers and the audio file are untouched. Returns `204`, or `404` for an unknown id. A transcript without a title is listed under its audio file name (`GET /transcripts`).

### `DELETE /transcripts/{id}`

Deletes transcript and all its segments, then calls `CommitService.recompute_or_remove()` for every speaker that appeared in it: the deleted audio no longer contributes to their stored embeddings, and unnamed speakers left without segments are removed from memory. If the transcript's audio file is inside `$SONORUS_DATA_DIR/recordings/` (a live recording or the copy of an imported file) and no other transcript references it, the file is deleted too; the user's original imported file elsewhere on disk is never touched (a symlink is removed as a link). Returns `204`, or `404` for an unknown id.

### `PATCH /transcripts/{id}/segments/{start}/text`

```json
{ "text": "Good morning everyone." }
```

Returns `204`.

### `PATCH /transcripts/{id}/segments/{start}/speaker`

```json
// Assign to an existing speaker:
{ "speaker_id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca" }

// Assign to a new speaker (creates a UUID with this display name):
{ "speaker_name": "Carol", "color_index": 2 }
```

Exactly one of `speaker_id` (a UUID4 of a known speaker — one with a voice profile or a display name) or `speaker_name` (1–128 chars, trimmed) must be provided, otherwise `400`. Optional `color_index` (`0`–`4`) sets the new speaker's palette color; it is only accepted together with `speaker_name` and inside the palette, otherwise `400` (nothing is created). Without it a color is assigned automatically. Returns `204`.

Reassigns only this one segment (unlike `POST /reassign` which is bulk). After updating the DB, immediately recomputes embeddings for both the new speaker (`commit_speaker`) and the previous speaker (`recompute_or_remove`).

### `DELETE /transcripts/{id}/segments/{start}`

Deletes one segment, then calls `recompute_or_remove()` for its speaker (same rules as transcript deletion). Returns `204`.

### `POST /transcripts/{id}/reassign`

Bulk-reassigns **all** segments of one speaker to another across the transcript, then recomputes embeddings.

`from_speaker_id` may be `"UNASSIGNED"` to assign every unassigned segment of the transcript.

Exactly one of `to_speaker_id` or `to_speaker_name` must be provided:

```json
// Assign to a new person (creates a new UUID; color_index is optional):
{ "from_speaker_id": "7e251ba6-...", "to_speaker_name": "Alice", "color_index": 1 }

// Merge into an existing recognized speaker:
{ "from_speaker_id": "7e251ba6-...", "to_speaker_id": "385dbc1d-..." }
```

- `to_speaker_name` — generates a new UUID4, saves the display name to `speaker_names`, recomputes the embedding from all DB segments. Optional `color_index` sets its palette color, with the same rules as for `PATCH /segments/{start}/speaker` (`400` with `to_speaker_id` or outside the palette).
- `to_speaker_id` — must be a known speaker: in `speaker_embeddings` or with a display name in `speaker_names` (a speaker created on segments too short for an embedding has no profile yet), otherwise `404`. Recomputes that speaker's embedding from all their DB segments, creating it if the speaker had none.
- Also commits embeddings for any other unrecognized speakers in the transcript not yet in memory.
- Recomputes `from_speaker_id` embedding from their remaining segments, or removes them from memory if no segments remain and they have no display name.

Returns `204`.

---

## Speakers

### `GET /speakers`

Returns **every** speaker: those with a voice profile (`speaker_embeddings`), a display name (`speaker_names`), or segments assigned to them. `name` is `null` for unrecognized (unnamed) speakers. Named speakers come first, sorted by name; unnamed ones follow, most recently seen first.

```json
[
  {
    "id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca",
    "name": "Alice",
    "color_index": 2,
    "segments": 14,
    "transcripts": 3,
    "duration_sec": 312.4,
    "last_seen": "2026-09-27T10:15:02.123456"
  }
]
```

`color_index` is an index (0–4) into the fixed 5-entry palette in `utils.js`. Assigned once when the speaker is first saved, using the least-used palette slot to minimize collisions; the user can change it with `PATCH /speakers/{id}`. Stored in `speaker_meta` (schema v3).

`segments`, `transcripts`, `duration_sec` (sum of segment lengths) and `last_seen` (`created_at` of the newest transcript) count segments whose `speaker_id` is this speaker; unassigned segments are not counted. The editor keeps only the named rows (`buildKnownMap`, `namedSpeakers` in `utils.js`).

### `PATCH /speakers/{id}`

Changes the display name and/or color. At least one field is required.

```json
{ "name": "Alice Ivanova", "color_index": 3 }
```

- `name` — 1–128 chars, trimmed. Names need not be unique: two people named "Alice" are two speaker ids. The UI marks speakers that share a name.
- `color_index` — `0..4`, otherwise `400`.

Works for any speaker listed by `GET /speakers`, including one that only has segments (naming it makes it recognized). Returns `200` with the updated `GET /speakers` row, `400` for an empty body, `404` for an unknown id. Never touches the embedding.

### `POST /speakers/{id}/rename`

`id` must be a UUID in `speaker_embeddings`.

```json
{ "name": "Alice Ivanova" }
```

Returns `204`. Returns `404` if speaker is not in `known_speakers`. Only updates `speaker_names` — does not touch the embedding or count. Kept for compatibility; new code uses `PATCH /speakers/{id}`.

### `DELETE /speakers/{id}`

Deletes a speaker through `CommitService.delete_speaker()`: every segment assigned to it becomes **unassigned** (`speaker_id = NULL`, `unassigned = 1`), then its embedding, names and color are removed. Future recordings no longer match the deleted voice.

```json
{ "segments": 12, "transcripts": 3 }
```

Returns the number of segments and transcripts that became unassigned, `404` for an unknown id, and `409` while a transcription job or an audio capture is running (the pipeline job holds its own memory snapshot and would write the profile back when it commits).

### `GET /speakers/{id}/sample`

A segment to play as the speaker's voice sample. Optional `?transcript_id=` limits it to one transcript.

```json
{ "transcript_id": 7, "audio_path": "/home/user/rec/weekly.wav", "start": 9.0, "end": 15.0, "text": "Yes, first item is the release." }
```

Chosen by `pick_voice_sample()` (`app/services/voice_sample.py`): only segments whose audio file still exists; segments of at least 2 s are preferred; among them the one whose embedding is closest to the speaker's voice profile, or the longest one when there is no profile or embedding. Returns `404` for an unknown speaker or when none of its recordings is available on disk.

### `GET /speakers/{id}/transcripts`

Transcripts in which the speaker has segments, newest first. `404` for an unknown speaker.

```json
[
  { "id": 7, "title": "Weekly sync", "created_at": "2026-09-27T10:15:02", "segments": 5, "duration_sec": 48.2 }
]
```

---

## Data

### `POST /data/reset`

Deletes all user data and returns the backend to an empty library:

- every transcription and segment (`transcriptions`, `segments`);
- every speaker, **named ones included** — `speaker_embeddings`, `speaker_names`, `speaker_meta`;
- the contents of `$SONORUS_DATA_DIR/recordings/` (live recordings and copies of imported files).

The API memory singleton is emptied too, including its pending dirty sets, so a later `save()` cannot write old speakers back. Schema/version tables (`_meta`, `_ts_schema_version`), downloaded models and `settings.json` are kept. The user's original imported files outside the data directory are never deleted; symlinks inside the cleared directories are removed as links without touching their targets.

```json
{ "transcripts": 2, "speakers": 3, "files": 5 }
```

Returns `409` while a transcription job (`POST /transcribe`) or an audio capture (`POST /audio/capture/start`) is running: the pipeline job holds its own memory snapshot and would write its transcript and speakers back after the reset.

---

## Health

### `GET /health`

```json
{ "status": "ok" }
```

---

## Dependency injection

All routers use FastAPI `Depends` with `lru_cache` singletons from `app/api/dependencies.py`. Both services are initialized sequentially at startup via FastAPI `lifespan` before any requests are accepted.

```python
# tests override the singletons
from app.api.dependencies import get_memory_service, get_storage_service

app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=str(tmp / "test.db"))
app.dependency_overrides[get_memory_service]  = lambda: SpeakerMemoryService(db_path=str(tmp / "mem.db"))
```

See `tests/` for the full test suite (379 tests total).
