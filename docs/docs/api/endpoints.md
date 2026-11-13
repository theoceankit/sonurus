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

The API version (`info.version` in `/openapi.json`) is the product version, resolved by `app/version.py`: `SONORUS_VERSION` (set by Electron from `package.json` when it starts the backend) → the `version` field of the repo's `package.json` (a backend started by hand) → `unknown`.

---

## Audio Capture

Manages live system audio recording sessions. The backend dispatches to the correct platform tool (`sonorus-capture` on macOS, `parec` on Linux, `sonorus-capture.exe` — WASAPI loopback — on Windows). Recordings with system audio are loudness-levelled (`ffmpeg dynaudnorm`, each track); mic + system tracks are then mixed with `ffmpeg amix` when both are present.

### `GET /audio/capture/sources`

Returns available system audio sources for the current platform.

```json
// macOS
[{ "id": "sckit", "label": "System audio (ScreenCaptureKit)" }]

// Linux: the default output's monitor first, then each output device's monitor
// named after the device (pactl sink description); without pactl only the first entry
[{ "id": "@DEFAULT_MONITOR@", "label": "System audio (default)" },
 { "id": "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", "label": "Built-in Audio Analog Stereo" },
 { "id": "bluez_output.58_18_62_38_72_FA.1.monitor", "label": "WH-1000XM5" }]

// Windows: the default output device first, then every active output device by name
// (empty when the helper is missing or lists nothing)
[{ "id": "default", "label": "System audio (default)" },
 { "id": "{0.0.0.00000000}.{a1b2…}", "label": "Headphones (USB Audio)" },
 { "id": "{0.0.0.00000000}.{c3d4…}", "label": "Speakers (Realtek(R) Audio)" }]
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

- `400` — capture cannot run; `detail` says why and nothing is recorded: macOS helper missing or not ready, Linux `parec` not installed (names the package), the selected Linux source is no longer available, Windows helper missing, no Windows output device or the selected one is gone, or the capture process exited right after start (its stderr).

### `POST /audio/capture/stop/{job_id}`

Stops the capture process and returns the path to the recorded WAV file, loudness-levelled. Optionally merges with a microphone recording (both tracks levelled, then mixed). If levelling fails, the recording is stored without it.

```json
// Request (optional)
{ "mic_path": "<data-dir>/recordings/sonorus-rec-abc123.webm" }

// Response 200 (with or without mic_path)
{ "file_path": "<data-dir>/recordings/sonorus-rec-d63f61eb.wav" }
```

- `404` — job not found (already stopped or invalid ID)
- `400` — nothing was captured; `detail` is platform-specific (the Screen Recording permission hint only on macOS)

### `POST /audio/recordings`

Stores a live recording made in the window (the `MediaRecorder` blob). The body is the raw audio; `Content-Type` picks the format: `audio/webm` (parameters such as `;codecs=opus` are ignored) or `audio/wav` / `audio/x-wav` / `audio/wave`. The file is written to `$SONORUS_DATA_DIR/recordings/sonorus-rec-<uuid>.<ext>` — the backend is the only writer of that directory, so a recording always lands where the backend looks for it, whichever data dir Electron uses. It appears under its final name only once complete.

```json
// Response 201
{ "file_path": "<data-dir>/recordings/sonorus-rec-5b0c….webm" }
```

- `415` — unsupported or missing `Content-Type`
- `400` — empty recording
- `500` — the file could not be written

The returned path is passed on as `mic_path` to `POST /audio/capture/stop/{job_id}` or queued directly with `POST /queue/jobs` (a file already in `recordings/` is not copied).

---

## Transcription queue

Transcription jobs are persisted in the database and run one at a time by the queue ([Transcription Queue](../services/TranscriptionQueue.md)). The queue as a whole is **running** or **paused**; pausing stops the running job at once and it runs again from the start later. A backend that starts with jobs waiting (e.g. one interrupted by closing the app) comes up paused; with nothing waiting it comes up running in auto mode and paused in manual mode. Each job's pipeline runs in a child process ([Pipeline Process](../services/PipelineProcess.md)).

### Job

```json
{
  "id": "d63f61eb-d5f6-40e2-a866-edb3aa1f96bb",
  "audio_path": "/data/recordings/sonorus-import-….wav",  // the app's copy
  "title": "Weekly sync",
  "whisper_model": "large-v3",
  "language": null,               // null = auto-detect
  "status": "waiting",            // "waiting" | "running" | "failed"
  "error": null,                  // message of the last failure
  "error_code": null,             // "alignment_model_missing", "whisper_model_missing", "diarization_model_missing" or null
  "error_language": null,         // language of a missing alignment model
  "created_at": "2026-09-28T13:00:17.512300"
}
```

A finished job leaves the queue (it is a transcript now, see `job_done` below). A failed job moves to the end of the queue and is skipped until it is retried.

### Snapshot — `GET /queue`

```json
{
  "type": "snapshot",
  "paused": true,
  "paused_by_recording": false,   // the pause came from a live recording
  "recording": false,
  "start_mode": "auto",           // "auto" | "manual"
  "running_job_id": null,
  "step": null,                   // progress step of the running job
  "jobs": [ /* Job, in queue order */ ]
}
```

The control endpoints below return the snapshot after the change.

| Endpoint | Effect |
|---|---|
| `POST /queue/start` | Runs the queue |
| `POST /queue/pause` | Pauses it; the running job stops at once and goes back to `waiting` |
| `POST /queue/recording/start` | A live recording started: if the queue runs, it pauses (`paused_by_recording`) |
| `POST /queue/recording/stop` | Call after queuing the new recording. The queue resumes only in `auto` mode and only if the recording paused it |
| `PUT /queue/settings` `{"start_mode": "manual"}` | `auto`: a running queue waits for new jobs when it runs out. `manual`: it pauses itself when nothing is left. Stored; `422` for other values |
| `PUT /queue/order` `{"job_ids": [...]}` | New order; must list every job exactly once, else `400` |

### `POST /queue/jobs`

Adds a job at the end of the queue and returns it (`status: "waiting"`). In `auto` mode a running queue picks it up; a paused queue stays paused.

```json
{
  "audio_path": "/absolute/path/to/file.wav",
  "whisper_model": "large-v3",   // optional — omit to use WHISPER_MODEL from config
  "language": "ru",              // optional — omit, null or "auto" for auto-detection
  "title": "Weekly sync"         // optional — defaults to the audio file name without extension
}
```

**Guards** — `400`, nothing is queued. The body is `{"detail": "…", "code": "…"}` (`RefusalResponse`): `detail` is a message for the user that names the file but never shows its path, `code` says what it is about, so a client acts on the code, not the wording:

| Condition | `code` | `detail` |
|---|---|---|
| Whisper model not installed | `whisper_model_missing` | `"Whisper model \"large-v3\" is not installed. Download it in Settings."` |
| Diarization model not installed | `diarization_model_missing` | `"Diarization model is not installed. Download it in Settings."` |
| Explicit language in `ALIGNMENT_CATALOG` and alignment model not installed | `alignment_model_missing` | `"Alignment model for language \"ru\" is not installed. Download it in Settings."` |
| File missing | `audio_not_found` | `"\"meeting.mp3\" could not be found."` |
| File not readable | `audio_not_readable` | `"\"meeting.mp3\" could not be read."` |
| Copy failed (e.g. no disk space) | `audio_copy_failed` | `"\"meeting.mp3\" could not be copied."` (the error itself goes to the log) |
| `PATCH` of the job that is running (status `409`) | `job_running` | `"This job has started and can no longer be changed."` |

Other errors of the queue routes (`404`, other `409`s, `422`) keep FastAPI's plain `{"detail": …}`.

**Audio copy** — an imported file (anything outside `$SONORUS_DATA_DIR/recordings/`) is copied to `recordings/sonorus-import-<uuid>.<ext>` before the job is queued; the job and later the transcript reference the copy, and the original is never touched. A live recording is used as it is. See [Audio Store](../services/AudioStore.md).

With auto-detection the alignment guard cannot fire up front. If the detected language needs an alignment model that is not installed (by the same check as `GET /models`, so an interrupted download counts as not installed), the job fails with `error_code: "alignment_model_missing"` and `error_language`.

A job never downloads a model. Before it starts, the worker checks that its Whisper model, the diarization model and the alignment model of its explicit language are installed (they may have been deleted after the job was queued); if not, the job fails at once — before any transcription — with `error_code: "whisper_model_missing"` (`"Whisper model \"small\" is not installed. Download it in Settings."`), `"diarization_model_missing"` or `"alignment_model_missing"` (with `error_language`). With auto-detect the language, and so its alignment model, is known only mid-pipeline. The pipeline child runs with `HF_HUB_OFFLINE=1`, so models load from the local cache only.

### `PATCH /queue/jobs/{id}`

Changes `title`, `whisper_model` and/or `language` — only the fields sent (`language: null` or `"auto"` = auto-detect). Allowed for waiting and failed jobs. `404` unknown job, `409` with `code: "job_running"` for the running job, `400` with a model `code` as above if the new Whisper or alignment model is not installed, `422` for a blank title or one over 200 characters.

### `DELETE /queue/jobs/{id}`

Deletes the job **and its audio** — the live recording, or the copy of an imported file (the user's original stays). A running job is stopped first. `{"deleted": true}`, or `404` for an unknown job.

### `POST /queue/jobs/{id}/retry`

A failed job becomes `waiting` again at the end of the queue, its error cleared. `404` unknown job, `409` if the job has not failed, `400` if its Whisper, diarization or (explicit-language) alignment model is not installed (same codes and texts as `POST /queue/jobs`; the job stays failed).

### `WS /ws/queue`

Sends the current snapshot on connect, then a snapshot after every change and these events:

```json
{ "type": "job_done",   "job_id": "…", "title": "Weekly sync", "transcript_id": 42 }
{ "type": "job_failed", "job_id": "…", "title": "Weekly sync",
  "error": "CUDA out of memory", "error_code": null, "error_language": null }
{ "type": "heartbeat" }   // every 10 s while nothing changes — ignore
```

The running job's progress is the snapshot's `step`: `Loading models…`, `Transcribing audio…`, `Identifying speakers…`, `Building transcript…`, `Saving to database…`. Closing the socket changes nothing in the queue.

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
  { "id": "large-v3", "installed": true, "name": "Whisper Large v3", "size": "1.55 GB", "speed": "~1× realtime", "acc": "Best", "recommended": true, "kind": "whisper" },
  { "id": "diarize", "installed": true, "name": "Pyannote Community 1", "size": "130 MB", "speed": "—", "acc": "Speaker separation", "recommended": false, "kind": "diarization" },
  { "id": "ru", "installed": false, "size": "~1.3 GB", "kind": "alignment" }
]
```

Alignment rows have only `id`, `installed`, `size` and `kind`; the UI names the languages itself. `size` is the download, the files an alignment download takes (see below), worked out from the catalog's `size_bytes`: `~1.3 GB`, `~385 MB`.

### `GET /models/folder`

Where this backend keeps the models: `.models/` in its data dir, the folder of all three kinds, as an absolute path. Settings → Models shows it. `exists` is `false` until the first download creates the folder; the request does not create it.

```json
{ "path": "/home/user/.config/sonorus/.models", "exists": true }
```

### `POST /models/{model_id}/download`

Starts a background download via `huggingface_hub.snapshot_download`. Returns a `job_id` immediately.

Whisper downloads only the files faster-whisper loads (`_WHISPER_ALLOW_PATTERNS`). An alignment download first lists the repo's files (`huggingface_hub.list_repo_files`) and downloads only what WhisperX loads: `config.json`, `preprocessor_config.json`, `vocab.json`, `tokenizer_config.json`, `special_tokens_map.json` and `added_tokens.json` where the repo has them, and one weights file, `model.safetensors` if there is one, else `pytorch_model.bin`. The repos also hold Flax weights, KenLM language models and training leftovers, which alignment never reads. A repo with neither weights file fails with `failed`. Models downloaded in full by earlier versions stay installed as they are. The progress counts only the files to download (`huggingface_hub.model_info`), or the catalog's `size_bytes` when that fails.

Files come as a plain HTTP download from the Hub's CDN, with Xet switched off (`HF_HUB_DISABLE_XET` in the download's child process). hf_xet fetches a file's chunks in parallel and writes them to disk in large bursts, so the bytes the progress is polled from would stand still and then jump; a plain download grows steadily and resumes from a partial blob. If the Hub's server refuses the plain download — an HTTP error other than 401, 403 or a gated repo (`is_server_refusal()`) — that repo's partial blobs are removed and the same download runs once more through Xet; an error of that second try is the download's error. Errors of the network, the token or access to the model are not retried.

Valid `model_id` values:
- Whisper: `tiny`, `base`, `small`, `medium`, `large-v3`
- Diarization: `diarize` (downloads `pyannote/speaker-diarization-community-1` + `pyannote/embedding`)
- Alignment: two-letter language code from `ALIGNMENT_CATALOG` — `ru`, `zh`, `ja`, `ko`, `uk`, `pt`, `ar`, `nl`, `pl`, `hi`, `cs`, `tr`, `hu`, `fi`, `fa`, `el`, `da`, `he`, `vi`, `ur`, `te`, `ca`, `ml`, `no`, `nn`, `sk`, `sl`, `hr`, `ro`, `eu`, `gl`, `ka`, `lv`, `tl`, `sv`

Unknown `model_id` returns `422`. One download per model: a `POST` while that model is downloading starts nothing and returns the running download's `job_id` (two downloads would write into the same cache), so a client that lost its connection can follow the same download again.

```json
{ "job_id": "a1b2c3d4-..." }
```

### `DELETE /models/{model_id}/download/{job_id}`

Cancels an in-progress download. Sets a `threading.Event`; each `snapshot_download` runs in a child process, which is terminated immediately, so the transfer stops mid-file. Partial files stay in the cache and a later download resumes them. The WS receives a `cancelled` event.

- `200` — cancel signal sent
- `404` — job not found

### `WS /ws/models/{job_id}`

Streams download progress. Sends heartbeats every 15 s to keep the connection alive during large downloads. Any number of connections may follow one download, each from the latest event at the time it connects: a connection that drops loses nothing for the next one. A finished download keeps its final event for the last 16 downloads, so a connection after the end still gets how it ended.

```json
{ "type": "heartbeat" }
{ "type": "progress", "pct": 47.3 }   // byte-level progress, 0–100
{ "type": "done" }
{ "type": "cancelled" }
{ "type": "error", "message": "...", "code": "no_token" }
```

`pct` is computed from filesystem polling of the HuggingFace blob directory — reflects actual bytes written to disk. It never goes down: when a download retries through Xet and its partial blobs are removed, `pct` holds until the bytes catch up.

`message` of an error is the exception as raised, such as `GatedRepoError: 401 Client Error …`. `code` says why, for an interface to say in its own words (`download_error_code()` in `ModelService`, by the class names of huggingface_hub's, requests' and httpx' errors and the HTTP status):

| `code` | When |
|---|---|
| `no_token` | HTTP 401: no HuggingFace token, or one the Hub does not accept. A gated repo asked without a token answers 401 too. |
| `no_access` | HTTP 403, or a gated repo otherwise: the token has no access to the model, such as its terms not accepted on the model page. |
| `network` | No connection to the Hub: connection refused or reset, a timeout, offline with nothing in the cache. |
| `failed` | Anything else, and a download after which the model is still not installed. |

`done` means the model is installed: after `snapshot_download` returns, each repo is checked as `GET /models` checks it. Offline, `snapshot_download` returns the cached snapshot of an interrupted earlier download without fetching its missing files; such a download ends in `error` with `code: "failed"`, not `done`.

An `Unknown job` error (the job never was, or ended long ago) has no `code`.

### `DELETE /models/{model_id}`

Removes the model's HuggingFace cache directory from disk.

- `200 {"deleted": "large-v3"}` — success
- `404` — model is not installed
- `409 {"detail": "In use by the running transcription"}` — the running job uses it (its Whisper model, the diarization model, or the alignment model of its explicit language)
- `422` — unknown `model_id`

---

## GPU acceleration

The optional CUDA download of the packaged app (Linux, Windows) — see [GPU Pack](../services/GpuPack.md) for the states, files and the self-check. The Electron app restarts the backend to apply a download or a removal.

### `GET /gpu`

```json
{
  "blocked_reason": null,
  "gpu": { "name": "NVIDIA GeForce RTX 4060", "driver": "615.78.08", "compute_capability": "8.9" },
  "min_driver": "570",
  "min_compute_capability": "7.0",
  "state": "not_installed",
  "pending": null,
  "error": null,
  "download_size": 3920000000,
  "device": "cpu",
  "torch": "2.8.0+cpu"
}
```

- `blocked_reason` — `null`, or why no download is offered: `unsupported_platform` (macOS), `not_packaged` (development), `no_nvidia`, `driver_too_old`, `gpu_too_old`.
- `gpu` — the first GPU `nvidia-smi` reports, or `null`.
- `state` — `not_installed`, `downloading`, `pending_restart` (with `pending`: `install` / `remove`), `active`, `error` (with `error`: the self-check's message), `stale` (installed for another PyTorch version).
- `device` / `torch` — what the running backend uses (`config.DEVICE`, `torch.__version__`).

### `POST /gpu/download`

Starts the download in a background thread and returns `{"job_id": "..."}`. Allowed in `not_installed`, `error` and `stale`.

- `409 {"detail": "<blocked_reason>"}` — the GPU does not qualify
- `409 {"detail": "already_downloading"}`
- `409 {"detail": "installed"}` — `active` or `pending_restart`

### `DELETE /gpu/download/{job_id}`

Cancels the download; nothing of it stays on disk. `404` for an unknown job.

### `WS /ws/gpu/{job_id}`

```json
{ "type": "progress", "phase": "download", "pct": 47, "downloaded": 1842000000, "total": 3920000000 }
{ "type": "progress", "phase": "install" }
{ "type": "heartbeat" }
{ "type": "done" }
{ "type": "cancelled" }
{ "type": "error", "message": "Not enough disk space: 11.8 GB needed, 5.0 GB free" }
```

The final event is kept until a WebSocket reads it, so a client may connect after a fast download finished.

### `DELETE /gpu/pack`

- `{"result": "removed"}` — a download not yet applied was deleted; nothing to restart
- `{"result": "restart"}` — the installed pack is removed at the next backend start (`pending_restart`, `pending: "remove"`)
- `404` — nothing installed; `409` — a download is running

### `POST /gpu/restart`

Asked by the app before it restarts the backend to apply a download or a removal.

- `{"status": "ready"}` — restart now; the queue starts no new job and resumes after the restart if it was running
- `{"status": "waiting", "reason": "recording" | "model_download" | "gpu_download" | "transcription"}` — ask again later; for `transcription` the running job finishes and no other job starts
- `409` — nothing to apply (`state` is not `pending_restart`)

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
    "opened": false,
    "speakers": ["385dbc1d-ec85-4486-9b91-f80b7dfdf1ca"],
    "duration": "14 min"
  }
]
```

`speakers` is a list of speaker UUIDs (may include unrecognized ones without a display name). `opened` is false until the user opens the transcript (`POST /transcripts/{id}/opened`), and again after Mark as unread (`DELETE /transcripts/{id}/opened`); transcripts that existed before the flag count as opened.

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

### `GET /transcripts/{id}/audio`

The audio file of a recording, for the UI's player. Answers `Range` requests with `206`, so an audio element can seek. The path comes from the database only. Returns `404` for an unknown id, or when the recording has no file or its file is gone.

### `GET /transcripts/{id}/waveform`

Heights for the player's waveform: `bars` (1–2000) evenly over `start`…`end` seconds of the recording. `start` is `0` by default and `end` the end of the audio; past the end of the audio is silence.

```json
{ "levels": [0.0, 0.62, 1.0] }
```

Each level is from `0` (silence) to `1` (the loud part of the whole recording), so a quiet recording fills the height and a clip has the scale of its recording. The loudness comes from ffmpeg and is cached next to the audio ([Waveform](../services/Waveform.md)); the first request for a recording without the cache waits for it, a few seconds for three hours. Returns `404` for an unknown id or when the audio is gone, `422` for `bars` out of range or `end` not after `start`, `500` when ffmpeg cannot read the audio.

### `GET /transcripts/{id}/speaker-candidates`

For each speaker without a display name in the transcript: the known speakers whose voice is closest, and a clip to hear the voice. Reads speaker memory only. Returns `404` for an unknown id.

```json
{
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": {
    "candidates": [
      { "speaker_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": "Alice", "score": 0.72, "suggested": true },
      { "speaker_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "name": "Carol", "score": 0.21, "suggested": false }
    ],
    "clip": { "start": 12.4, "end": 16.1, "text": "That was me." }
  }
}
```

- `candidates`: up to three named speakers with a voice profile, most similar first. Empty when no speaker is named or the voice has no embeddings; the entry is still there.
- `score`: cosine similarity between the mean of the speaker's segment embeddings in this transcript and the profile, rounded to two digits, not below 0.
- `suggested`: true only for the first candidate, when its `score` reaches `SPEAKER_SUGGESTION_THRESHOLD` (`app/config.py`).
- `clip`: a segment of this transcript chosen by `pick_voice_sample()` (see `GET /speakers/{id}/sample`), compared with the speaker's voice in this transcript. `null` when the audio file no longer exists.

Unassigned segments and named speakers get no entry.

### `PATCH /transcripts/{id}`

```json
{ "title": "Weekly sync" }
```

Renames the transcript. `title` is trimmed and must be 1–200 characters (`422` otherwise). Only transcript metadata changes — segments, speakers and the audio file are untouched. Returns `204`, or `404` for an unknown id. A transcript without a title is listed under its audio file name (`GET /transcripts`).

### `POST /transcripts/{id}/opened`

Marks the transcript as opened by the user. No body. Only this flag changes: speakers, segments and the title are untouched. Calling it again is fine. Returns `204`, or `404` for an unknown id. `GET /transcripts/{id}` does not set it, so loading a transcript for any other reason leaves it new. The UI calls it once a recording has loaded on the screen.

### `DELETE /transcripts/{id}/opened`

Marks the transcript as not opened, as Mark as unread in the recordings list asks. No body. Only this flag changes, as with `POST`; calling it again is fine. Returns `204`, or `404` for an unknown id. The transcript is listed as new until `POST /transcripts/{id}/opened`.

### `DELETE /transcripts/{id}`

Deletes transcript and all its segments, then calls `CommitService.recompute_or_remove()` for every speaker that appeared in it: the deleted audio no longer contributes to their stored embeddings, and unnamed speakers left without segments are removed from memory. If the transcript's audio file is inside `$SONORUS_DATA_DIR/recordings/` (a live recording or the copy of an imported file) and no other transcript references it, the file is deleted too; the user's original imported file elsewhere on disk is never touched (a symlink is removed as a link). Returns `204`, or `404` for an unknown id.

### `PATCH /transcripts/{id}/segments/{start}/text`

```json
{ "text": "Good morning everyone." }
```

Returns `204`.

### `POST /transcripts/{id}/speaker-assignments`

Gives the listed segments one speaker, all or none. The UI uses it for a turn, a paragraph and all segments of a voice.

```json
// An existing speaker:
{ "segment_starts": [12.5, 18.0], "speaker_id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca" }

// A new speaker (creates a UUID with this display name):
{ "segment_starts": [12.5, 18.0], "speaker_name": "Carol", "color_index": 2, "speaker_handle": "carol.k" }
```

Exactly one of `speaker_id` (a UUID4 of a known speaker — one with a voice profile or a display name) or `speaker_name` (1–128 chars, trimmed) must be provided, otherwise `400`. Optional `color_index` (`0`–`4`) sets the new speaker's palette color; it is only accepted together with `speaker_name` and inside the palette, otherwise `400`. Without it a color is assigned automatically. Optional `speaker_handle` gives the new speaker a handle set by hand, by the rules of `PATCH /speakers/{id}`; it too is only accepted with `speaker_name`, otherwise `400`, and without it the speaker gets the handle made from the name. A taken or invalid handle is refused (`409` `handle_taken`, `400` `handle_invalid`) before anything changes. An empty list is `422`. An unknown transcript or a start with no segment is `404`, and then nothing changes and no speaker is created. Returns `200`:

```json
{ "speaker_id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca" }
```

The segments change in one transaction, and their flag `unassigned` clears. Then `commit_speaker` recomputes the new speaker and `recompute_or_remove` each previous one.

### `POST /transcripts/{id}/speaker-assignments/undo`

Puts segments back under the speaker they had before an assignment. A reverse assignment would not do: the speaker given back may be a voice the assignment removed from memory, and a new speaker it created would stay behind.

```json
{
  "segment_starts": [12.5, 18.0],
  "speaker_id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca",
  "created_speaker_id": "7f0c2c54-1f5d-4b53-8a0e-6c7b2f0a9d11"
}
```

- `speaker_id`: who had the segments, a UUID4 or `"UNASSIGNED"`, otherwise `400`. It need not be in memory, since the assignment may have removed the voice.
- `created_speaker_id`: optional, the speaker the assignment made.
- A start with no segment is skipped: it was deleted since the assignment.

`CommitService.undo_assignment()` recomputes `speaker_id`, which brings back a removed voice, and then each speaker who held the segments. A speaker from `created_speaker_id` with no segments left is removed, or the undone voice would stay as their profile and catch the same voice in the next recording. A named speaker left with nothing to compute a voice from keeps the name and color and loses the profile. The color of a voice brought back may differ from the one it had; it shows only once the voice gets a name.

Returns `204`, or `404` for an unknown transcript.

### `DELETE /transcripts/{id}/segments/{start}`

Deletes one segment, then calls `recompute_or_remove()` for its speaker (same rules as transcript deletion). Returns `204`.

---

## Speakers

### `GET /speakers`

Returns **every** speaker: those with a voice profile (`speaker_embeddings`), a display name (`speaker_names`), or segments assigned to them. `name` is `null` for unrecognized (unnamed) speakers. Named speakers come first, sorted by name (case and surrounding spaces ignored); unnamed ones follow, most recently seen first. Speakers that tie, such as two with the same name, keep one order between calls: the most recently seen first, then by id.

```json
[
  {
    "id": "385dbc1d-ec85-4486-9b91-f80b7dfdf1ca",
    "name": "Alice",
    "handle": "alice",
    "handle_manual": false,
    "color_index": 2,
    "segments": 14,
    "transcripts": 3,
    "duration_sec": 312.4,
    "last_seen": "2026-09-27T10:15:02.123456"
  }
]
```

`color_index` is an index (0–4) into the fixed 5-entry palette of speaker colours (`ui/src/styles/speaker-colors.ts`, `--color-speaker-1…5` in `tokens.css`). Assigned once when the speaker is first saved, using the least-used palette slot to minimize collisions; the user can change it with `PATCH /speakers/{id}`. Stored in `speaker_meta` (schema v3).

`handle` is the speaker's unique handle (`@` is not part of it), `null` for an unnamed speaker: every speaker with a name has one and only they do. `handle_manual` is `true` for a handle set by hand, which stays when the name changes; otherwise the handle follows the name. See [Speaker handles](#speaker-handles).

`segments`, `transcripts`, `duration_sec` (sum of segment lengths) and `last_seen` (`created_at` of the newest transcript) count segments whose `speaker_id` is this speaker; unassigned segments are not counted. The editor keeps only the named rows (`buildKnownMap`, `namedSpeakers` in `utils.js`).

### `PATCH /speakers/{id}`

Changes the display name, color and/or handle. At least one field is required.

```json
{ "name": "Alice Ivanova", "color_index": 3, "handle": "alice.i" }
```

- `name` — 1–128 chars, trimmed. Names need not be unique: two people named "Alice" are two speaker ids. The UI marks speakers that share a name. A new name moves a handle that was not set by hand: it becomes the one made from the new name.
- `color_index` — `0..4`, otherwise `400`.
- `handle` — a handle set by hand: a leading `@`, spaces around and the case do not matter (it is kept in lowercase). `""` goes back to the handle made from the name. A refusal changes nothing, the name included:

| Condition | Status | `code` | `detail` |
|---|---|---|---|
| Not a handle | `400` | `handle_invalid` | `"Use lowercase Latin letters, digits, dots, hyphens and underscores, up to 32, starting with a letter or a digit."` |
| Another speaker has it, in any case | `409` | `handle_taken` | `"@alice is taken by Alice Smith."` |
| The speaker has no name and gets none | `400` | `handle_needs_name` | `"Give the speaker a name first."` |

Works for any speaker listed by `GET /speakers`, including one that only has segments (naming it makes it recognized and gives it a handle). Returns `200` with the updated `GET /speakers` row, `400` for an empty body, `404` for an unknown id. Never touches the embedding.

### `POST /speakers/{id}/rename`

`id` must be a UUID in `speaker_embeddings`.

```json
{ "name": "Alice Ivanova" }
```

Returns `204`. Returns `404` if speaker is not in `known_speakers`. Only updates `speaker_names` and a handle that follows the name — does not touch the embedding or count. Kept for compatibility; new code uses `PATCH /speakers/{id}`.

### Speaker handles

A handle is the speaker's unique id for people, as in `@ivan.petrov`, next to a display name that may repeat. The backend alone makes handles (`app/services/speaker_handle.py`):

- **Format**: lowercase Latin letters, digits, `.`, `_` and `-`, 1–32 characters, starting with a letter or a digit. Unique among all speakers whatever the case; the database keeps it so (a unique index on `speaker_meta.handle`).
- **From the name**: the first word is the first name and the last word the last name; the words between are left out, and a single word is the handle by itself. Cyrillic goes by the Russian passport scheme (ж → zh, х → kh, ц → ts, ч → ch, ш → sh, щ → shch, ю → yu, я → ya, й → i; ь and ъ are dropped), other Latin letters lose their accents, and anything else is dropped. A name with no Latin letter left gives `speaker`.
- **Handle format**: `first.last` (`ivan.petrov`, the default), `f.last` (`i.petrov`) or `first.l` (`ivan.p`). It applies to handles made from now on: changing it changes no handle already given.
- **Taken**: a handle made from a name that another speaker has gets the smallest free number from 2 on its end: `ivan.petrov2`, `ivan.petrov3`. A number freed by a deleted speaker is used again.
- **Who gets one**: a speaker gets a handle with a name, and keeps it until they are deleted or the data is reset. A schema v4 upgrade gives every named speaker one, the one heard first (the earliest transcript) without a number.

#### `GET /speakers/handle-suggestion?name=…&exclude=…`

The handle a speaker named `name` gets now, numbered if taken: `{"handle": "ivan.petrov2"}`. `exclude` (optional) is a speaker whose own handle counts as free, for a speaker being renamed. Changes nothing.

#### `GET /speakers/handle-format` and `PUT /speakers/handle-format`

`{"format": "first.last"}` — the handle format, kept in `_meta` (`handle_format`). `PUT` takes the same body; another value is `422`. Delete all data keeps it, as it is a preference.

### `DELETE /speakers/{id}`

Deletes a speaker through `CommitService.delete_speaker()`: every segment assigned to it becomes **unassigned** (`speaker_id = NULL`, `unassigned = 1`), then its embedding, names and color are removed. Future recordings no longer match the deleted voice.

```json
{ "segments": 12, "transcripts": 3 }
```

Returns the number of segments and transcripts that became unassigned, `404` for an unknown id, and `409` while a transcription job or an audio capture is running (the running job holds its own memory snapshot and would write the profile back when it commits). Queued jobs do not block it: they resolve speakers when they run.

### `GET /speakers/{id}/sample`

A segment to play as the speaker's voice sample. Optional `?transcript_id=` limits it to one transcript.

```json
{ "transcript_id": 7, "audio_path": "/home/user/rec/weekly.wav", "start": 9.0, "end": 15.0, "text": "Yes, first item is the release." }
```

Chosen by `pick_voice_sample()` (`app/services/voice_sample.py`): only segments whose audio file still exists; segments of at least 2 s are preferred; among them the one whose embedding is closest to the speaker's voice profile, or the longest one when there is no profile or embedding. Returns `404` for an unknown speaker or when none of its recordings is available on disk.

### `GET /speakers/{id}/transcripts`

Transcripts in which the speaker has segments, newest first. `has_audio` is false when the recording's audio file is gone, so a sample from it cannot play. `404` for an unknown speaker.

```json
[
  { "id": 7, "title": "Weekly sync", "created_at": "2026-09-27T10:15:02", "segments": 5, "duration_sec": 48.2, "has_audio": true }
]
```

---

## Data

### `POST /data/reset`

Deletes all user data and returns the backend to an empty library:

- every transcription and segment (`transcriptions`, `segments`);
- every speaker, **named ones included** — `speaker_embeddings`, `speaker_names`, `speaker_meta`;
- the contents of `$SONORUS_DATA_DIR/recordings/` (live recordings and copies of imported files);
- every job in the transcription queue.

The API memory singleton is emptied too, including its pending dirty sets, so a later `save()` cannot write old speakers back. Schema/version tables (`_meta`, `_ts_schema_version`), downloaded models and `settings.json` are kept. The user's original imported files outside the data directory are never deleted; symlinks inside the cleared directories are removed as links without touching their targets.

```json
{ "transcripts": 2, "speakers": 3, "files": 5 }
```

Returns `409` while a transcription job is running (pause the queue first) or an audio capture (`POST /audio/capture/start`) is running: the running job holds its own memory snapshot and would write its transcript and speakers back after the reset. The queue does not start a job while the reset runs.

---

## Health

### `GET /health`

```json
{ "status": "ok", "data_dir": "/home/user/.config/sonorus", "packaged": true, "pid": 12345 }
```

- `data_dir` — the backend's `SONORUS_DATA_DIR`, absolute, symlinks resolved.
- `packaged` — `true` if the installed app started it (`SONORUS_PACKAGED=1`), `false` for dev mode and a manual `uvicorn`.
- `pid` — the backend's process id.

Electron reuses a backend already on port 8000 only if it is its own (same `data_dir`; in dev mode any backend with `packaged: false`) and stops such a backend by `pid` when it restarts it — see [Configuration](../environment/configuration.md#sonorus_data_dir).

---

## Dependency injection

All routers use FastAPI `Depends` with `lru_cache` singletons from `app/api/dependencies.py`. The services and the transcription queue are created at startup via FastAPI `lifespan` before any requests are accepted; the lifespan also starts the queue's worker and stops it on shutdown (a running job goes back to `waiting`).

```python
# tests override the singletons
from app.api.dependencies import get_memory_service, get_storage_service

app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=str(tmp / "test.db"))
app.dependency_overrides[get_memory_service]  = lambda: SpeakerMemoryService(db_path=str(tmp / "mem.db"))
```

`tests/conftest.py` also replaces `get_transcription_queue` in every test with a paused queue on a temporary database, so no test touches the real `DB_PATH`. See [Testing](../testing/overview.md).
