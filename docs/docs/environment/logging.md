---
sidebar_position: 3
---

# Logging

Structured logging for the application pipeline, database operations, and speaker memory. On by default for both the API server and CLI — can be silenced or changed via environment variables.

---

## Quick start

```bash
# API server — INFO by default, logs to stderr
uvicorn app.api.main:app --port 8000

# API server — silence logs
LOG_LEVEL=off uvicorn app.api.main:app --port 8000

# CLI — INFO by default
python main.py

# Write logs to a file as well
LOG_FILE=app.log uvicorn app.api.main:app --port 8000
```

Or add to `.env` to persist the setting:

```env
LOG_LEVEL=off   # silence all app logs
LOG_LEVEL=debug # verbose app logs
```

---

## Log levels

| Value | What you see |
|---|---|
| `off` | Nothing (default) |
| `info` | Pipeline steps, DB operations, speaker resolution |
| `debug` | Everything above + per-segment embedding attachment |
| `warning` | Recoverable unexpected state only |
| `error` | Failures only |

---

## Output format

```
HH:MM:SS [ServiceName] message
```

Examples:

```
12:34:51 [TranscriptionService] Loading WhisperX model (device=cuda)...
12:34:58 [TranscriptionService] Loading audio: testdata/output.wav
12:35:01 [TranscriptionService] Transcribing...
12:35:04 [TranscriptionService] Aligning (language=en)...
12:35:05 [TranscriptionService] Diarizing...
12:35:07 [TranscriptionService] Done — 27 segments
12:35:07 [EmbeddingService] Extracted embeddings — 3 speakers, 14 segments
12:35:07 [SpeakerMemoryService] Resolving 3 speakers against 5 known profiles
12:35:07 [SpeakerMemoryService] SPEAKER_00 → Alice (similarity 0.91)
12:35:07 [SpeakerMemoryService] SPEAKER_01 → spk_a1b2 (new)
12:35:07 [TranscriptBuilder] Built transcript — 27 segments, language=en
12:35:07 [CommitService] Committing 2 speakers to memory
12:35:07 [SpeakerMemoryService] Saved 6 speakers → speaker_memory.db
12:35:07 [DB] INSERT transcriptions id=42 audio=testdata/output.wav
12:35:07 [DB] INSERT segments 27 rows for transcription 42
```

---

## What each service logs

### TranscriptionService — `INFO`
- Model load (device)
- Each pipeline step: load audio, transcribe, align, diarize
- Final segment count

### EmbeddingService — `INFO`
- Model load (device)
- Extraction result: speaker and segment counts

### SpeakerMemoryService — `INFO`
- Speakers loaded from DB on startup
- Resolution: known profiles count, per-speaker match result with similarity score
- Save: speaker count and DB path

### TranscriptBuilder — `INFO` / `DEBUG`
- `INFO` — transcript built: segment count and language
- `DEBUG` — embedding attachment: how many segments received an embedding

### CommitService — `INFO`
- Speaker count being committed to memory

### DB (`TranscriptStorageService`) — `INFO`
- `INSERT` — transcription row (id, audio path) and segment row count
- `UPDATE` — speaker reassignment (bulk or single segment)
- `SELECT` — transcription and segment rows on load

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `off` | Log level: `debug`, `info`, `warning`, `error`, `off` |
| `LOG_FILE` | — | Path to a log file; output goes to both stderr and the file |

---

## Implementation

| File | Role |
|---|---|
| `app/logger.py` | `setup_logging(default_level)` — configures the `app` logger; `get_logger(name)` — returns a named child logger |
| `app/api/main.py` | Calls `setup_logging(default_level="info")` — API server is on by default |
| `main.py` | Calls `setup_logging(default_level="info")` — CLI is on by default |

### Relation to `VERBOSE`

`VERBOSE` and `LOG_LEVEL` are independent:

| | Controls |
|---|---|
| `VERBOSE` | Noise from ML libraries (WhisperX, Lightning, PyAnnote) |
| `LOG_LEVEL` | App-level logs from services |

Both can be active at the same time. See [Configuration](./configuration.md) for details on `VERBOSE`.
