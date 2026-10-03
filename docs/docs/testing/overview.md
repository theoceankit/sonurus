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

Renderer scripts are classic browser scripts (no modules). `tests/renderer/load-renderer.js` evaluates them in a `node:vm` context, so their top-level function declarations (e.g. `fileUrl()` from `utils.js`) can be tested with `node:test` without a browser. Pass stubs for browser globals via the second argument of `loadRenderer(files, globals)`. Views that build DOM (modals, Settings rows, the queue job modal) run against the permissive fake DOM in `tests/renderer/fake-dom.js`; `tests/renderer/models-fixture.js` provides a `GET /models` catalog. Layout and visual behaviour are verified manually in the running app.

---

## Current coverage

One row per test file: Python unit and API tests (`tests/test_*.py`, no ML models are loaded) and renderer tests (`tests/renderer/*.test.js`, `node:test`). Test counts are not kept here — run the suites for them. `test_testing_docs.py` fails when a test file has no row or a row names a file that does not exist.

| File | What it covers |
|---|---|
| `test_api.py` | End-to-end API routes: transcripts CRUD, speaker rename, delete → speaker recompute, single-segment reassign, live-recording and import-copy cleanup on `DELETE /transcripts/{id}` (originals/escaping/symlinked/shared files kept), orphan import copies removed at startup (copies of transcripts and queued jobs kept), `POST /data/reset` (DB + files, imported files kept, 409 while a job runs), Speakers section (`GET /speakers` with unnamed speakers and statistics, `PATCH` name/color (shared names allowed), `DELETE` → unassigned segments and 409 while a job runs, `GET /speakers/{id}/transcripts`, `GET /speakers/{id}/sample`, reassigning unassigned segments), `color_index` for a speaker created by name, assigning a named speaker without a voice profile, `PATCH /transcripts/{id}` title (trimmed, 404, 422 for blank / over 200 chars) |
| `test_transcript_storage_service.py` | `save()`, `load()`, `update_*` (incl. `update_title()`), `list_all()`, `audio_files()`, `delete_segment()`, `clear()`, `count_by_audio_file()`, `get_embeddings_grouped_by_transcript()`, segment indexes, `load(with_embeddings=False)`, unassigned segments + schema v5 migration, schema v6 (raw labels → UUID / unassigned), `speaker_stats()`, `transcripts_for_speaker()` |
| `test_speaker_memory_service.py` | `resolve()` purity, `set_name()` / `get_name()`, persistence, `save_names_only()`, `find_by_name()`, UUID migration, `clear()` (DB + in-memory + dirty sets), `speaker_ids()`, `set_color()`, removing name-only speakers |
| `test_model_service.py` | `WHISPER_CATALOG`, `list_models()`, `is_installed()`, `download_model()`, `delete_model()` for Whisper models |
| `test_alignment_model.py` | `ALIGNMENT_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for alignment models |
| `test_commit_service.py` | `CommitService` API contract, `commit()`, `commit_speaker()`, `commit_new_speakers()`, `commit_recognized_speakers()`, `recompute_or_remove()`, `delete_speaker()`, `UNASSIGNED` never committed |
| `test_diarization_model.py` | `DIARIZATION_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for diarize model |
| `test_speaker_color.py` | `speaker_meta` color persistence, least-used palette assignment, schema v3 migration |
| `test_models_api.py` | `GET /models`, `POST /models/{id}/download`, `DELETE /models/{id}`, WS progress stream |
| `test_transcription_guard.py` | `POST /queue/jobs` 400 guard when Whisper / diarization / alignment model not installed (auto-detect not blocked); `TranscriptionService` raises `AlignmentModelMissingError` with the language; missing-model texts quote the model id like the job error |
| `test_queue_api.py` | `/queue` API: adding (import copied, live recording not, default title / model, `auto` language → null, 400 for a missing file or failed copy), snapshot, start / pause, recording endpoints, start mode setting, `PATCH` (only fields sent, 404 / 409 running / 400 model not installed / 422), `DELETE` with audio, retry, order, `WS /ws/queue` (snapshot, changes, `job_done`), old `/transcribe` endpoints gone; speaker delete and data reset 409 only while a job runs, reset clears a paused queue; retry `400` without the job's Whisper / diarization model; `DELETE /models/{id}` `409` for the running job's models (its explicit language's alignment model too, not with auto-detect) |
| `test_transcription_queue.py` | `TranscriptionQueue` with a stand-in runner: start-up state (empty queue runs in auto mode, waits in manual mode; left-over waiting jobs pause it; failed jobs alone do not), order, auto vs manual start mode, pause re-runs a job from the start, failures to the end + skipped, alignment failure fields, retry, delete (waiting / running, audio inside `recordings/` only), edit (not the running job), reorder, recording pause / auto-resume rules, `hold()`, subscribers, snapshots in order across threads, stop and interruption keep the job waiting |
| `test_job_store.py` | `JobStore`: fields, order, persistence, edit, move to end, reorder validation, delete, running → waiting, clear, audio paths, settings, shared DB file with transcripts |
| `test_transcription_job.py` | `make_job_runner()`: save with the job title + commit, cancel after the pipeline saves nothing, models released on failure / cancel, a failed commit keeps the saved transcript, child-process mode (no models in the backend, saved through storage, cancel passed through) |
| `test_job_models.py` | A job never downloads models: `require_job_models()` (Whisper first, then diarization, then the alignment model of an explicit language), `run_job` checks before the pipeline, the queue fails the job with `whisper_model_missing` / `diarization_model_missing`, the pipeline child sets `HF_HUB_OFFLINE=1` before loading models |
| `test_pipeline_process.py` | `run_pipeline_process()`: progress relayed, result returned, cancel stops the child at once (also mid-step and before start), `on_progress` errors stop it, child errors / missing alignment model / crash mapped to exceptions, SIGTERM from outside = interruption; group signals do not reach the child, the child exits when the backend dies; the real worker with a fake pipe; `Transcript` with embeddings survives pickling |
| `test_transcript_builder.py` | `TranscriptBuilder.build()` (WhisperX output → Transcript, UUID for unmatched `SPEAKER_XX`, `UNKNOWN` → unassigned) and `attach_embeddings()` (time-overlap matching) |
| `test_download_progress.py` | WS byte-level progress stream, polling loop, `done`/`error` events |
| `test_audio_store.py` | `import_audio()` (unique copy, extension, live recording kept, symlink followed, no partial copy on error), `is_import_copy()`, `discard_import()`, `discard_owned_audio()` (copies and live recordings, never files outside `recordings/`, symlink targets kept), `remove_orphan_imports()`, `save_recording()` (live recording named `sonorus-rec-*`, format whitelist, empty body rejected, nothing left on failure) |
| `test_recordings_api.py` | `POST /audio/recordings`: stored in the backend's `RECORDINGS_DIR` by `Content-Type` (webm/wav), `415` for other types, `400` for an empty body |
| `test_audio_capture.py` | `AudioCaptureService` start/stop/merge, `has_active_jobs()`, recordings dir, stderr-deadlock regression, `/audio/capture/*` routes |
| `test_logger.py` | `setup_logging()`, `get_logger()`, `LOG_LEVEL` env var, file logging |
| `test_transcribe_schema.py` | `TranscribeRequest` schema validation, optional `whisper_model` and `language` fields |
| `test_embedding_persistence.py` | Per-segment embedding round-trip through `save()` / `load()` |
| `test_model_cancel.py` | `cancel_event` in `download_model()`, `DELETE /models/{id}/download/{job_id}`, WS `cancelled` event |
| `test_voice_sample.py` | `pick_voice_sample()`: closest to the voice profile, longest fallback, ≥ 2 s preference, missing audio files skipped |
| `test_embedding_service.py` | `EmbeddingService.extract_all()` single-pass invariant |
| `test_version.py` | `get_version()`: `SONORUS_VERSION` wins over `package.json`, blank env ignored, missing / broken / version-less `package.json` → `unknown`, the repo's `package.json` by default; OpenAPI `info.version` is the product version |
| `test_testing_docs.py` | This page: every test file has exactly one row in the coverage table, no row for a missing file, no test-count column |
| `tests/renderer/utils.test.js` | `fileUrl()`, `fileBaseName()`, `isUnrecognized()`, `buildKnownMap()`, `listSystemAudioSources()`, `uploadRecording()` |
| `tests/renderer/avatar.test.js` | `makeAvatar()` (initials, palette color, size class; unrecognized speaker is a grey `?`; size presets only, from CSS), `makeNameAvatar()`, `setAvatarName()`, `makeAvatarStack()` (max avatars, hover titles); initials drawn only by the avatar component, old per-place classes gone, initials not selectable, a CSS rule per size preset |
| `tests/renderer/not-implemented.test.js` | `NOT_IMPLEMENTED` registry, one toast text, `markNotImplemented()`, `notImplementedClick()` (marked control or container stopped, other clicks pass), capture-phase guard; call sites (each id marks one control, no id outside the registry), no ad-hoc "not implemented" toasts or TODO markers, load order in `index.html`, `app.js` installs the guard |
| `tests/renderer/app-version.test.js` | `formatAppVersion()` (with / without a version); the main process answers `get-app-version`, preload exposes `getAppVersion`, the backend gets `SONORUS_VERSION`, Settings shows the version line |
| `tests/renderer/recording-modal-toggles.test.js` | The Recording modal has only the "Diarize speakers" toggle; Start passes no `saveAudio`, an old `recordingSaveAudio` setting is ignored, no renderer source mentions it |
| `tests/renderer/settings-reset.test.js` | `defaultSettingsPatch()`, `dataResetBlockReason()`, `formatDataResetSummary()` |
| `tests/renderer/sidebar-delete.test.js` | `withoutRecording()`, `deleteTranscriptPrompt()` |
| `tests/renderer/speakers.test.js` | `filterSpeakers()`, `duplicateNameIds()`, `speakerDisplayName()`, `speakerStatsLine()`, `deleteSpeakerPrompt()`, `buildKnownMap()` skipping unnamed rows, `effectiveSpeaker()` for unassigned segments |
| `tests/renderer/new-speaker.test.js` | `leastUsedColorIndex()`, `hasSpeakerNamed()`, `speakerAssignRequest()` (one segment vs all segments, by id vs new name + color) |
| `tests/renderer/transcript-title.test.js` | `titleToSave()` (trim, blank / unchanged / over 200 chars skipped), `transcriptTitleRequest()` |
| `tests/renderer/editor-scroll.test.js` | `preserveScroll()` — the editor keeps its scroll position when it rebuilds after an edit |
| `tests/renderer/editor-player-state.test.js` | `playerClock()` (time, duration, play state from the audio element; unknown duration), `activeSegmentIndex()` (inside, at start / end, between, before / after segments) |
| `tests/renderer/segment-row-layout.test.js` | A segment row's layout does not depend on its speaker: no speaker-change marker, one-line speaker name of fixed height |
| `tests/renderer/file-drop.test.js` | `isSupportedAudio()`, `dropDecision()` (home / editor import, settings / speakers / open modal ignore, a live recording does not block, unsupported files skipped), `importRequest()` |
| `tests/renderer/queue-edit.test.js` | `canEditJob()`, `jobEditPatch()` (only changed fields, trimmed title, `auto` language ↔ null, blank / over 200 chars refused), `jobEditRequest()`, `reorderJobIds()` (before / after, onto itself, unknown ids, input unchanged), `dropPlace()` |
| `tests/renderer/queue.test.js` | `queueStateLabel()`, `queueToggle()`, `queueJobCount()`, `jobStatusText()` (step, waiting / paused, first error line, missing alignment model), `deleteJobPrompt()` (import vs live recording), `importRequest()` → `POST /queue/jobs`, `dataResetBlockReason()` asks to pause the queue |
| `tests/renderer/modal-import.test.js` | `modalImportItems()` (typed / default / blank title, several files, unsupported skipped, order), `importStartToast()` / `skippedFilesToast()`; the New Recording modal with a fake DOM: drop of several files, only unsupported files keep it open, dialog with several files, typed vs default title, cancelled dialog |
| `tests/renderer/transcribe-defaults.test.js` | Transcription defaults with a permissive fake DOM (`fake-dom.js`): the language picked in Settings is saved; the New Recording modal starts from the defaults, and its own model / language choice reaches the import or recording without being saved |
| `tests/renderer/file-drop-events.test.js` | `initFileDrop()` with stub `window` / `document`: overlay show / hide, a drop already handled by the modal is not imported again, non-file drags untouched, drop effect per view |
| `tests/renderer/settings-models.test.js` | Settings rows build without errors (fake DOM): `makeModelRow()` for Whisper (installed / not) and diarization, `makeAlignmentModelRow()`, `makeSectionHeader()` |
| `tests/renderer/icons.test.js` | `icon()` / `hydrateIcons()` markup; every icon name used in the renderer has a file in `electron/assets/icons/`; files are kebab-case with `xmlns` + `viewBox`; no inline SVG icons; no local variable named `icon`; renderer scripts still parse |
| `tests/renderer/default-model.test.js` | Default transcription model: `resolveTranscribeModel()` (kept, previous from the history, most accurate installed, none), `pushModelHistory()`, `noModelMessage()` / `settingsModelHint()`; `syncTranscribeModel()` on a stub `fetch` (first download, deleted default, last model deleted, saved but not installed, backend down), `selectTranscribeModel()`, `dropImportOptions()`; the New Recording modal (checking / no model / no diarization: Start and Import off, notice, modal drop refused; disabled options; fresh catalog; a model picked in the modal is kept); Settings (hint, **In use** only when installed, Use saves history); no hard-coded default model. Catalog from `models-fixture.js` |
| `tests/renderer/model-delete.test.js` | Deleting a model the queue needs: `queuedJobsUsingModel()`, `modelInUseByRunningJob()`, `modelDeletePrompt()`; Settings (confirmation with the job count, Cancel deletes nothing, no jobs → delete at once, button off while the running job uses the model, 409 toast); `jobStatusText()` for a missing Whisper / diarization model (names the model the job failed on, not an edited one); queue job modal (models not downloaded disabled, the job's deleted model stays shown) |
| `tests/renderer/default-language.test.js` | Default language without its alignment model: `missingAlignmentModel()`, `jobBlockMessage()` (Whisper → diarization → language), queued / running jobs counted by language; window drop refused with a toast; New Recording modal (languages without a model disabled, default language blocks Start / Import and drops, Detect unblocks); Settings (warning with Download, none when not needed or installed, deleting the default language's model resets it to Detect, confirmation / disabled delete for alignment models) |
| `tests/renderer/model-downloads.test.js` | `model-downloads.js` with a stub `WebSocket`: start (token, job WS, progress to subscribers), done re-resolves the default with its toast, error / cancelled, cancel (also before the backend answered), leaving Settings keeps the download and coming back shows its progress |
| `tests/renderer/dropdown.test.js` | `makeDropdown()`: a disabled option is marked and cannot be picked; other options work as before |
| `tests/renderer/toast-layer.test.js` | `#toast-stack` has the highest `z-index` in `styles/*.css`, so toasts stay above modals and overlays |

---

## File structure

Every `test_*.py` and `renderer/*.test.js` file is listed in [Current coverage](#current-coverage); the tree shows the shared helpers.

```
tests/
├── conftest.py                        # ML library stubs, no-network downloads
├── download_workers.py                # App-free stand-ins for subprocess download workers
├── pipeline_workers.py                # App-free stand-ins for the pipeline child process
├── queue_helpers.py                   # Stand-in pipeline runner + wait_for for queue tests
├── test_*.py                          # Python unit and API tests
└── renderer/
    ├── load-renderer.js               # Evaluates renderer scripts in a node:vm context
    ├── fake-dom.js                    # Permissive fake DOM for views and modals
    ├── models-fixture.js              # GET /models catalog for model-related tests
    └── *.test.js                      # node:test renderer tests
```

---

## Design conventions

- No ML models are loaded — all heavy calls (`snapshot_download`, `whisperx.load_model`, etc.) are patched via `unittest.mock`.
- Database tests use `tmp_path` (pytest fixture) — each test gets an isolated SQLite file.
- API tests use `TestClient` with `app.dependency_overrides` to inject in-memory services.
- Model directory constants (`config.WHISPER_MODELS_DIR`, `config.HF_MODELS_DIR`, `config.ALIGNMENT_MODELS_DIR`) are patched per-fixture to avoid touching the real model cache.
- A new test file needs a row in [Current coverage](#current-coverage) — `test_testing_docs.py` enforces it.
