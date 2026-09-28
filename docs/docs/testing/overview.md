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

# Renderer unit tests (Node >= 22, no dependencies)
node --test 'tests/renderer/*.test.js'
```

### No network in tests

`tests/conftest.py` replaces `huggingface_hub.snapshot_download` (no-op) and `huggingface_hub.model_info` (raises `OSError`, so download size falls back to the catalog estimate) for the whole session. Download jobs run in background threads that outlive a test's own `patch()`, so a per-test stub is not enough. `ModelService.RUN_DOWNLOADS_IN_SUBPROCESS` is also set to `False`, so tests can patch `snapshot_download` in-process, and `pipeline_process.RUN_PIPELINE_IN_SUBPROCESS` to `False`, so tests can patch `create_controller`. An autouse fixture replaces `get_transcription_queue` in every test with a paused queue on a temporary database, so no test touches the real `DB_PATH` (without `SONORUS_DATA_DIR` that is the project root).

### CI environment

The Tests workflow (`.github/workflows/tests.yml`) installs only `requirements-test.txt` — no `torch`, `huggingface_hub`, WhisperX or PyAnnote. `tests/conftest.py` replaces those modules with `MagicMock` stubs in `sys.modules` when they are not importable. A local `.venv` has the real libraries, so two classes of failure show up only in CI:

- **Spawned child processes do not get the stubs.** A `multiprocessing` child re-imports the module that defines its target function. Worker stand-ins for `_run_download(..., in_subprocess=True)` and `run_pipeline_process(..., worker=…)` therefore live in `tests/download_workers.py` and `tests/pipeline_workers.py`, which import no app code.
- **Slower runners expose timing races.** A background job thread may reach a patched call after the `POST` that started it has returned, so a patch must stay active until the job finishes (see `_running_job` in `test_transcription_guard.py`).

To reproduce CI locally, run the suite in a separate venv with only the test requirements:

```bash
python3.12 -m venv /tmp/ci-venv
/tmp/ci-venv/bin/pip install -r requirements-test.txt
/tmp/ci-venv/bin/python -m pytest tests/ -v
```

### Renderer tests

Renderer scripts are classic browser scripts (no modules). `tests/renderer/load-renderer.js` evaluates them in a `node:vm` context, so their top-level function declarations (e.g. `fileUrl()` from `utils.js`) can be tested with `node:test` without a browser. Pass stubs for browser globals via the second argument of `loadRenderer(files, globals)`. DOM-heavy behaviour is verified manually in the running app.

---

## Current coverage

**605 Python unit and API tests** across **25 files** — no ML models are loaded — plus **76 renderer tests** (`tests/renderer/*.test.js`, `node:test`).

| File | Tests | What it covers |
|---|---|---|
| `test_api.py` | 93 | End-to-end API routes: transcripts CRUD, speaker rename, delete → speaker recompute, single-segment reassign, live-recording and import-copy cleanup on `DELETE /transcripts/{id}` (originals/escaping/symlinked/shared files kept), orphan import copies removed at startup (copies of transcripts and queued jobs kept), `POST /data/reset` (DB + files, imported files kept, 409 while a job runs), Speakers section (`GET /speakers` with unnamed speakers and statistics, `PATCH` name/color (shared names allowed), `DELETE` → unassigned segments and 409 while a job runs, `GET /speakers/{id}/transcripts`, `GET /speakers/{id}/sample`, reassigning unassigned segments), `color_index` for a speaker created by name, assigning a named speaker without a voice profile, `PATCH /transcripts/{id}` title (trimmed, 404, 422 for blank / over 200 chars) |
| `test_transcript_storage_service.py` | 62 | `save()`, `load()`, `update_*` (incl. `update_title()`), `list_all()`, `audio_files()`, `delete_segment()`, `clear()`, `count_by_audio_file()`, `get_embeddings_grouped_by_transcript()`, segment indexes, `load(with_embeddings=False)`, unassigned segments + schema v5 migration, schema v6 (raw labels → UUID / unassigned), `speaker_stats()`, `transcripts_for_speaker()` |
| `test_speaker_memory_service.py` | 47 | `resolve()` purity, `set_name()` / `get_name()`, persistence, `save_names_only()`, `find_by_name()`, UUID migration, `clear()` (DB + in-memory + dirty sets), `speaker_ids()`, `set_color()`, removing name-only speakers |
| `test_model_service.py` | 31 | `WHISPER_CATALOG`, `list_models()`, `is_installed()`, `download_model()`, `delete_model()` for Whisper models |
| `test_alignment_model.py` | 29 | `ALIGNMENT_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for alignment models |
| `test_commit_service.py` | 28 | `CommitService` API contract, `commit()`, `commit_speaker()`, `commit_new_speakers()`, `commit_recognized_speakers()`, `recompute_or_remove()`, `delete_speaker()`, `UNASSIGNED` never committed |
| `test_diarization_model.py` | 25 | `DIARIZATION_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for diarize model |
| `test_speaker_color.py` | 25 | `speaker_meta` color persistence, least-used palette assignment, schema v3 migration |
| `test_models_api.py` | 22 | `GET /models`, `POST /models/{id}/download`, `DELETE /models/{id}`, WS progress stream |
| `test_transcription_guard.py` | 18 | `POST /queue/jobs` 400 guard when Whisper / diarization / alignment model not installed (auto-detect not blocked); `TranscriptionService` raises `AlignmentModelMissingError` with the language |
| `test_queue_api.py` | 21 | `/queue` API: adding (import copied, live recording not, default title / model, `auto` language → null, 400 for a missing file or failed copy), snapshot, start / pause, recording endpoints, start mode setting, `PATCH` (only fields sent, 404 / 409 running / 400 model not installed / 422), `DELETE` with audio, retry, order, `WS /ws/queue` (snapshot, changes, `job_done`), old `/transcribe` endpoints gone; speaker delete and data reset 409 only while a job runs, reset clears a paused queue |
| `test_transcription_queue.py` | 39 | `TranscriptionQueue` with a stand-in runner: paused after start-up / restart, order, auto vs manual start mode, pause re-runs a job from the start, failures to the end + skipped, alignment failure fields, retry, delete (waiting / running, audio inside `recordings/` only), edit (not the running job), reorder, recording pause / auto-resume rules, `hold()`, subscribers, snapshots in order across threads, stop and interruption keep the job waiting |
| `test_job_store.py` | 17 | `JobStore`: fields, order, persistence, edit, move to end, reorder validation, delete, running → waiting, clear, audio paths, settings, shared DB file with transcripts |
| `test_transcription_job.py` | 7 | `make_job_runner()`: save with the job title + commit, cancel after the pipeline saves nothing, models released on failure / cancel, a failed commit keeps the saved transcript, child-process mode (no models in the backend, saved through storage, cancel passed through) |
| `test_pipeline_process.py` | 15 | `run_pipeline_process()`: progress relayed, result returned, cancel stops the child at once (also mid-step and before start), `on_progress` errors stop it, child errors / missing alignment model / crash mapped to exceptions, SIGTERM from outside = interruption; group signals do not reach the child, the child exits when the backend dies; the real worker with a fake pipe; `Transcript` with embeddings survives pickling |
| `test_transcript_builder.py` | 21 | `TranscriptBuilder.build()` (WhisperX output → Transcript, UUID for unmatched `SPEAKER_XX`, `UNKNOWN` → unassigned) and `attach_embeddings()` (time-overlap matching) |
| `test_download_progress.py` | 19 | WS byte-level progress stream, polling loop, `done`/`error` events |
| `test_audio_store.py` | 13 | `import_audio()` (unique copy, extension, live recording kept, symlink followed, no partial copy on error), `is_import_copy()`, `discard_import()`, `discard_owned_audio()` (copies and live recordings, never files outside `recordings/`, symlink targets kept), `remove_orphan_imports()` |
| `test_audio_capture.py` | 17 | `AudioCaptureService` start/stop/merge, `has_active_jobs()`, recordings dir, stderr-deadlock regression, `/audio/capture/*` routes |
| `test_logger.py` | 12 | `setup_logging()`, `get_logger()`, `LOG_LEVEL` env var, file logging |
| `test_transcribe_schema.py` | 12 | `TranscribeRequest` schema validation, optional `whisper_model` and `language` fields |
| `test_embedding_persistence.py` | 11 | Per-segment embedding round-trip through `save()` / `load()` |
| `test_model_cancel.py` | 10 | `cancel_event` in `download_model()`, `DELETE /models/{id}/download/{job_id}`, WS `cancelled` event |
| `test_voice_sample.py` | 8 | `pick_voice_sample()`: closest to the voice profile, longest fallback, ≥ 2 s preference, missing audio files skipped |
| `test_embedding_service.py` | 3 | `EmbeddingService.extract_all()` single-pass invariant |
| `tests/renderer/utils.test.js` | 13 | `fileUrl()`, `fileBaseName()`, `isUnrecognized()`, `buildKnownMap()`, `listSystemAudioSources()` |
| `tests/renderer/settings-reset.test.js` | 9 | `defaultSettingsPatch()`, `dataResetBlockReason()`, `formatDataResetSummary()` |
| `tests/renderer/sidebar-delete.test.js` | 5 | `withoutRecording()`, `deleteTranscriptPrompt()` |
| `tests/renderer/speakers.test.js` | 11 | `filterSpeakers()`, `duplicateNameIds()`, `speakerDisplayName()`, `speakerStatsLine()`, `deleteSpeakerPrompt()`, `buildKnownMap()` skipping unnamed rows, `effectiveSpeaker()` for unassigned segments |
| `tests/renderer/new-speaker.test.js` | 6 | `leastUsedColorIndex()`, `hasSpeakerNamed()`, `speakerAssignRequest()` (one segment vs all segments, by id vs new name + color) |
| `tests/renderer/transcript-title.test.js` | 5 | `titleToSave()` (trim, blank / unchanged / over 200 chars skipped), `transcriptTitleRequest()` |
| `tests/renderer/editor-scroll.test.js` | 2 | `preserveScroll()` — the editor keeps its scroll position when it rebuilds after an edit |
| `tests/renderer/file-drop.test.js` | 12 | `isSupportedAudio()`, `dropDecision()` (home / editor import, settings / speakers / open modal ignore, recording blocks, unsupported files skipped), `importRequest()` |
| `tests/renderer/file-drop-events.test.js` | 6 | `initFileDrop()` with stub `window` / `document`: overlay show / hide, a drop already handled by the modal is not imported again, non-file drags untouched, drop effect per view |
| `tests/renderer/icons.test.js` | 7 | `icon()` / `hydrateIcons()` markup; every icon name used in the renderer has a file in `electron/assets/icons/`; files are kebab-case with `xmlns` + `viewBox`; no inline SVG icons; renderer scripts still parse |

---

## File structure

```
tests/
├── conftest.py                        # ML library stubs, no-network downloads
├── download_workers.py                # App-free stand-ins for subprocess download workers
├── pipeline_workers.py                # App-free stand-ins for the pipeline child process
├── queue_helpers.py                   # Stand-in pipeline runner + wait_for for queue tests
├── renderer/                          # node:test renderer tests + load-renderer.js
├── test_alignment_model.py
├── test_api.py                        # Full API integration
├── test_audio_store.py
├── test_audio_capture.py
├── test_commit_service.py
├── test_diarization_model.py
├── test_download_progress.py
├── test_embedding_persistence.py
├── test_embedding_service.py
├── test_job_store.py
├── test_logger.py
├── test_model_cancel.py
├── test_models_api.py
├── test_model_service.py
├── test_pipeline_process.py
├── test_queue_api.py
├── test_speaker_color.py
├── test_speaker_memory_service.py
├── test_transcribe_schema.py
├── test_transcript_builder.py
├── test_transcription_guard.py
├── test_transcription_job.py
├── test_transcription_queue.py
├── test_voice_sample.py
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
