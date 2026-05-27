---
sidebar_position: 1
---

# Testing Overview

## How to run

```bash
# All unit tests
pytest tests/ -v

# Single file
pytest tests/test_commit_service.py -v
```

---

## Current coverage

**334 unit and API tests** across **17 files** — no ML models are loaded.

| File | Tests | What it covers |
|---|---|---|
| `test_api.py` | 34 | End-to-end API routes: transcribe, transcripts CRUD, speaker rename, commit, cancel |
| `test_transcript_storage_service.py` | 32 | `save()`, `load()`, `update_*`, `list_all()`, `delete_segment()`, `get_embeddings_by_speaker()` |
| `test_speaker_memory_service.py` | 30 | `resolve()` purity, `set_name()` / `get_name()`, persistence, `save_names_only()`, `find_by_name()`, UUID migration |
| `test_alignment_model.py` | 29 | `ALIGNMENT_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for alignment models |
| `test_diarization_model.py` | 25 | `DIARIZATION_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for diarize model |
| `test_model_service.py` | 24 | `WHISPER_CATALOG`, `list_models()`, `is_installed()`, `download_model()`, `delete_model()` for Whisper models |
| `test_models_api.py` | 21 | `GET /models`, `POST /models/{id}/download`, `DELETE /models/{id}`, WS progress stream |
| `test_commit_service.py` | 20 | `CommitService` API contract, `commit()`, `commit_speaker()`, `commit_new_speakers()`, `commit_recognized_speakers()`, `recompute_or_remove()` |
| `test_download_progress.py` | 19 | WS byte-level progress stream, polling loop, `done`/`error` events |
| `test_transcription_guard.py` | 18 | `POST /transcribe` 400 guard when Whisper / diarization / alignment model not installed |
| `test_transcript_builder.py` | 18 | `TranscriptBuilder.build()` (WhisperX output → Transcript) and `attach_embeddings()` (time-overlap matching) |
| `test_archive_service.py` | 16 | `ArchiveService.archive()`, `format_time()` |
| `test_transcribe_schema.py` | 12 | `TranscribeRequest` schema validation, optional `whisper_model` and `language` fields |
| `test_logger.py` | 12 | `setup_logging()`, `get_logger()`, `LOG_LEVEL` env var, file logging |
| `test_embedding_persistence.py` | 11 | Per-segment embedding round-trip through `save()` / `load()` |
| `test_model_cancel.py` | 10 | `cancel_event` in `download_model()`, `DELETE /models/{id}/download/{job_id}`, WS `cancelled` event |
| `test_embedding_service.py` | 3 | `EmbeddingService.extract_all()` single-pass invariant |

---

## File structure

```
tests/
├── test_api.py                        # Full API integration
├── test_archive_service.py
├── test_commit_service.py
├── test_diarization_model.py
├── test_download_progress.py
├── test_embedding_persistence.py
├── test_embedding_service.py
├── test_logger.py
├── test_model_cancel.py
├── test_models_api.py
├── test_model_service.py
├── test_speaker_memory_service.py
├── test_transcribe_schema.py
├── test_transcript_builder.py
├── test_transcription_guard.py
└── test_transcript_storage_service.py
```

---

## Design conventions

- No ML models are loaded — all heavy calls (`snapshot_download`, `whisperx.load_model`, etc.) are patched via `unittest.mock`.
- Database tests use `tmp_path` (pytest fixture) — each test gets an isolated SQLite file.
- API tests use `TestClient` with `app.dependency_overrides` to inject in-memory services.
- Model directory constants (`config.WHISPER_MODELS_DIR`, `config.HF_MODELS_DIR`, `config.ALIGNMENT_MODELS_DIR`) are patched per-fixture to avoid touching the real model cache.

---

## Planned

Per [Product Vision → Testing](../roadmap/vision.md#6-testing):

- **Integration tests** — full pipeline without ML models (mock `TranscriptionService` and `EmbeddingService`), verifying that services wire together correctly end-to-end.
