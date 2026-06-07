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

// Windows
[{ "id": "wasapi", "label": "System audio" }]
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
{ "mic_path": "/tmp/sonorus-mic-abc123.wav" }

// Response 200
{ "file_path": "/tmp/sonorus-sys-d63f61eb.wav" }
// or, if mic_path was provided:
{ "file_path": "/tmp/sonorus-merged-d63f61eb.wav" }
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
  "language": "ru"               // optional — omit or null for auto-detection
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

When `language` is `null` (auto-detect), the guard for alignment models cannot fire before the job starts. If the detected language requires an alignment model that is not installed, the pipeline raises `AlignmentModelMissingError` and the WS emits a structured error event (see below).

### `WS /ws/{job_id}`

WebSocket that streams pipeline progress. Connect immediately after `POST /transcribe`.

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

Manages the local model cache. Install status is detected by checking for `refs/main` in the HuggingFace cache directory structure.

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

Cancels an in-progress download. Sets a `threading.Event` that stops the download loop between repos. The WS receives a `cancelled` event.

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
      "speaker_final": null
    }
  ]
}
```

`speaker_resolved` and `speaker_final` are always UUID4 strings. Display names are resolved separately via `GET /speakers`.

### `DELETE /transcripts/{id}`

Deletes transcript and all its segments. Returns `204`.

### `PATCH /transcripts/{id}/segments/{start}/text`

```json
{ "text": "Good morning everyone." }
```

Returns `204`.

### `PATCH /transcripts/{id}/segments/{start}/speaker`

```json
{ "speaker_id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca" }
```

`speaker_id` must be a UUID4. Returns `204`.

Reassigns only this one segment (unlike `POST /reassign` which is bulk). After updating the DB, immediately recomputes embeddings for both the new speaker (`commit_speaker`) and the previous speaker (`recompute_or_remove`).

### `DELETE /transcripts/{id}/segments/{start}`

Returns `204`.

### `POST /transcripts/{id}/reassign`

Bulk-reassigns **all** segments of one speaker to another across the transcript, then recomputes embeddings.

Exactly one of `to_speaker_id` or `to_speaker_name` must be provided:

```json
// Assign to a new person (creates a new UUID):
{ "from_speaker_id": "7e251ba6-...", "to_speaker_name": "Alice" }

// Merge into an existing recognized speaker:
{ "from_speaker_id": "7e251ba6-...", "to_speaker_id": "385dbc1d-..." }
```

- `to_speaker_name` — generates a new UUID4, saves the display name to `speaker_names`, recomputes the embedding from all DB segments.
- `to_speaker_id` — must be a UUID already in `speaker_embeddings`. Recomputes that speaker's embedding from all their DB segments.
- Also commits embeddings for any other unrecognized speakers in the transcript not yet in memory.
- Recomputes `from_speaker_id` embedding from their remaining segments, or removes them from memory if no segments remain and they have no display name.

Returns `204`.

### `POST /transcripts/{id}/commit`

Recomputes embeddings for all speakers in the transcript from all their segments across the entire database. Returns `204`.

---

## Speakers

### `GET /speakers`

Returns only **recognized** speakers — those with a display name in `speaker_names`. Unrecognized speakers (committed to memory but without a name) are excluded.

```json
[
  {
    "id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca",
    "name": "Alice",
    "color_index": 2
  }
]
```

`color_index` is an index (0–4) into the fixed 5-entry palette in `utils.js`. Assigned once when the speaker is first saved, using the least-used palette slot to minimize collisions. Stored in `speaker_meta` (schema v3).

### `POST /speakers/{id}/rename`

`id` must be a UUID in `speaker_embeddings`.

```json
{ "name": "Alice Ivanova" }
```

Returns `204`. Returns `404` if speaker is not in `known_speakers`. Only updates `speaker_names` — does not touch the embedding or count.

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
