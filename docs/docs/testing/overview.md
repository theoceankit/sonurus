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

# Electron main process tests (Node >= 22, no dependencies)
node --test 'tests/electron/*.test.js'

# UI unit tests and types (Node >= 22.22.2)
npm --prefix ui test
npm --prefix ui run typecheck

# End-to-end tests of the built app (needs .venv, ui/dist and a free port 8000)
npm run test:e2e

# Build tests: packaged dependencies and installer checks (Node >= 22)
node --test 'tests/build/*.test.js'
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

### API schema and types

The UI's types come from the API schema ([Data](../ui/electron/data.md)). `tests/test_openapi_schema.py` fails when `ui/src/api/openapi.json` differs from what the code gives, and holds the WebSocket events of the queue to their models. CI then checks that `ui/src/api/schema.gen.ts` matches that file:

```bash
npm --prefix ui/tools/openapi-types ci
npm --prefix ui/tools/openapi-types run check
```

Both pass in the CI environment: the schema is taken with the ML libraries stubbed. `npm run gen:api` regenerates both files.

### Electron tests

`tests/electron/` tests the main process (`electron/`) with `node:test` and no dependencies: which backend may be reused, the folder of the file dialog, the GPU pack, the app version on its way to the backend and the window, and that the app makes no third-party requests and captures no system audio in the window.

### End-to-end tests

`tests/e2e/` runs the built app as the user gets it: Electron with `ui/dist`, the main process and a real backend, driven by Playwright's `_electron`. `harness.js` makes a temporary data directory, seeds it with `seed.py` (two recordings with named and unnamed speakers, a tone as their audio), starts the backend on it and Electron with a profile in the same directory, and removes it all afterwards (`SONORUS_E2E_KEEP=1` keeps it, with `backend.log`). Whisper Small and the diarization model only look installed, and the queue starts paused on manual start, so nothing is transcribed and no model is loaded. The main process's file dialog is replaced by `stubOpenFiles()`.

```bash
npm run build:ui
npm run test:e2e        # one file at a time: the backend is always on port 8000
```

The tests refuse to start while something answers on port 8000, as Electron would use that backend and its data. They need the development `.venv` (the backend imports its ML libraries at start), so CI does not run them. Layout is still checked by eye: see [Development](../ui/electron/development.md#checking-on-isolated-data).

### Quality tests

`tests/quality/` runs the real models on a fixed set of AMI meeting recordings and scores the transcripts; it is skipped unless `SONORUS_QUALITY=1` (and always in CI). See [Quality Tests](quality.md).

### UI tests

`ui/` has its own tests next to the components, on Vitest and Testing Library in jsdom: `npm --prefix ui test`, plus `npm --prefix ui run typecheck`. CI runs both and builds `ui/dist` before the build tests. The tests of tokens and raw values walk the sources: see [Foundations](../ui/electron/foundations.md#raw-values). So does `ui/src/not-implemented.test.tsx`, which compares the list of unimplemented controls with the calls: see [Unimplemented controls](../ui/electron/foundations.md#unimplemented-controls). Vitest blanks CSS by default, including `?raw` imports, so `ui/vite.config.ts` turns that off. It needs Node.js 22.22.2+ (jsdom), as does the whole `ui/` package.

### Build tests

`tests/build/` checks the packaging inputs without building anything: the UI's window entry, CSP and packaging rules, the per-platform lock files and GPU manifests in `locks/`, the pruning of the bundled Python and the bundled import check (see [Packaging](../distribution/packaging.md#python-packages-lock-files)), the installer size check, the absence of a first-run setup in the Electron main process, the Electron version (native Wayland), the Visual C++ runtime copied into the Windows build and the app icons (PNG, ICNS and ICO are read with Node built-ins, since CI has no `node_modules`). Installers themselves are verified by building and running them.

---

## Current coverage

One row per test file: Python unit and API tests (`tests/test_*.py`, no ML models are loaded), Electron tests (`tests/electron/*.test.js`, `node:test`), build tests (`tests/build/*.test.js`, `node:test`) and end-to-end tests (`tests/e2e/*.test.js`). The tests of `ui/` sit next to their code and are not listed here. Test counts are not kept here — run the suites for them. `test_testing_docs.py` fails when a test file has no row or a row names a file that does not exist.

| File | What it covers |
|---|---|
| `test_cors.py` | `cors_origins()`: the local origins by default, the dev server's on request, never for a packaged backend; preflights for `null` and the dev server |
| `tests/build/ui-alignment-catalog.test.js` | The alignment models the UI names are the backend's `ALIGNMENT_CATALOG`, in its order |
| `tests/build/ui-entry.test.js` | The window loads `ui/dist` in both modes, the dev server only in development; `main.js` uses it, has no UI switch and keeps its security settings |
| `tests/build/window-chrome.test.js` | The window has no system frame, its window buttons match `tokens.css` in colours and height, and their strip dims with a modal's scrim |
| `tests/build/ui-package.test.js` | The CSP (in the build too, when there is one), dev additions limited to the dev server, Storybook telemetry off, fonts kept as files with their licence, stories for every component, no remote content in sources, only `ui/dist` packaged, no old renderer in `electron/`, Playwright only a dev dependency, build and checks in every build script and CI job, the archive check in `check-packaged-ui.js` (sources, Storybook and the old renderer refused) |
| `test_api.py` | End-to-end API routes: transcripts CRUD, speaker rename, delete → speaker recompute, single-segment reassign, live-recording and import-copy cleanup on `DELETE /transcripts/{id}` (originals/escaping/symlinked/shared files kept), orphan import copies removed at startup (copies of transcripts and queued jobs kept), `POST /data/reset` (DB + files, imported files kept, 409 while a job runs), Speakers section (`GET /speakers` with unnamed speakers and statistics, `PATCH` name/color (shared names allowed), `DELETE` → unassigned segments and 409 while a job runs, `GET /speakers/{id}/transcripts`, `GET /speakers/{id}/sample`, reassigning unassigned segments), `color_index` for a speaker created by name, assigning a named speaker without a voice profile, `PATCH /transcripts/{id}` title (trimmed, 404, 422 for blank / over 200 chars), `GET /health` reports `data_dir` (absolute), `packaged` and `pid`, `GET /transcripts/{id}/audio` (whole file, Range, 404 for no transcript, no file or an empty path) |
| `test_transcript_storage_service.py` | `save()`, `load()`, `update_*` (incl. `update_title()`), `list_all()`, `audio_files()`, `delete_segment()`, `clear()`, `count_by_audio_file()`, `get_embeddings_grouped_by_transcript()`, segment indexes, `load(with_embeddings=False)`, unassigned segments + schema v5 migration, schema v6 (raw labels → UUID / unassigned), `speaker_stats()`, `transcripts_for_speaker()` |
| `test_speaker_memory_service.py` | `resolve()` purity, `set_name()` / `get_name()`, persistence, `save_names_only()`, `find_by_name()`, UUID migration, `clear()` (DB + in-memory + dirty sets), `speaker_ids()`, `set_color()`, removing name-only speakers |
| `test_model_service.py` | `WHISPER_CATALOG`, `list_models()`, `is_installed()`, `download_model()`, `delete_model()` for Whisper models; symlink support settled for the repo folder before `snapshot_download` starts its threads (Windows without the symlink privilege) |
| `test_alignment_model.py` | `ALIGNMENT_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for alignment models |
| `test_commit_service.py` | `CommitService` API contract, `commit()`, `commit_speaker()`, `commit_new_speakers()`, `commit_recognized_speakers()`, `recompute_or_remove()`, `delete_speaker()`, `UNASSIGNED` never committed |
| `test_diarization_model.py` | `DIARIZATION_CATALOG`, `is_installed()`, `download_model()`, `delete_model()`, API routes for diarize model |
| `test_speaker_color.py` | `speaker_meta` color persistence, least-used palette assignment, schema v3 migration |
| `test_models_api.py` | `GET /models`, `POST /models/{id}/download` (a second POST while the model downloads returns the running job, other models download in parallel, a finished download lets a new one start), `DELETE /models/{id}`, WS progress stream |
| `test_transcription_guard.py` | `POST /queue/jobs` 400 guard when Whisper / diarization / alignment model not installed (auto-detect not blocked); `TranscriptionService` raises `AlignmentModelMissingError` with the language, also for an interrupted download (`refs/main` with the download marker or `*.incomplete` blobs); missing-model texts quote the model id like the job error |
| `test_queue_api.py` | `/queue` API: adding (import copied, live recording not, default title / model, `auto` language → null, 400 for a missing file or failed copy), snapshot, start / pause, recording endpoints, start mode setting, `PATCH` (only fields sent, 404 / 409 running / 400 model not installed / 422), `DELETE` with audio, retry, order, `WS /ws/queue` (snapshot, changes, `job_done`), old `/transcribe` endpoints gone; speaker delete and data reset 409 only while a job runs, reset clears a paused queue; retry `400` without the job's Whisper / diarization model; `DELETE /models/{id}` `409` for the running job's models (its explicit language's alignment model too, not with auto-detect) |
| `test_gpu_pack.py` | `GpuPack`: `parse_nvidia_smi()` / `detect_gpu()` (first GPU, no GPU, missing / failing / timing out `nvidia-smi`), `blocked_reason()` per platform, packaging, driver and compute capability, numeric version compare, GPU detected once; `state()` (not installed, active, installed but not loaded, self-check error, stale torch, download waiting, removal waiting, incomplete download, damaged `pack.json`), `status()`; `download()` with stand-in stream and pip (verified wheels installed into `incoming/`, ordered progress, wrong sha256 / size, cancel while downloading or installing, failed install, network error, not enough disk, leftover cleared, blocked GPU) — nothing left in `incoming/` after a failure; `remove()` (installed → marker, pending download dropped, both) |
| `test_gpu_probe.py` | `app.gpu_probe.probe()` with stand-in torch / ctranslate2: working GPU, CUDA unavailable, failing kernel, CTranslate2 without GPU, import error; `main()` prints JSON and exits 0 / 1 |
| `test_gpu_api.py` | `/gpu` with a stand-in `GpuPack.download`: status (packaged, not packaged), download progress → `pending_restart`, `downloading` + second download 409, cancel, errors (sha256, disk space, network), 409 for a GPU that does not qualify or a pack installed / pending, download again after an error or a torch change; `DELETE /gpu/pack` (restart, removed, 404, 409 while downloading); `POST /gpu/restart` (409 with nothing to apply, ready, waits for a recording, a model download, the running transcription); `models.active_downloads()` |
| `test_transcription_queue.py` | `TranscriptionQueue` with a stand-in runner: start-up state (empty queue runs in auto mode, waits in manual mode; left-over waiting jobs pause it; failed jobs alone do not), order, auto vs manual start mode, pause re-runs a job from the start, failures to the end + skipped, alignment failure fields, retry, delete (waiting / running, audio inside `recordings/` only), edit (not the running job), reorder, recording pause / auto-resume rules, `hold()`, subscribers, snapshots in order across threads, stop and interruption keep the job waiting; `prepare_restart()` (idle queue held and resumed after the restart, a running job finishes and no other starts, a paused queue stays paused, the mark is used once, an old mark is ignored) |
| `test_job_store.py` | `JobStore`: fields, order, persistence, edit, move to end, reorder validation, delete, running → waiting, clear, audio paths, settings, shared DB file with transcripts |
| `test_transcription_service.py` | `TranscriptionService.transcribe()` result keeps the language Whisper used (auto-detected or explicit) after alignment and speaker assignment |
| `test_transcription_job.py` | `make_job_runner()`: save with the job title + commit, cancel after the pipeline saves nothing, models released on failure / cancel, a failed commit keeps the saved transcript, child-process mode (no models in the backend, saved through storage, cancel passed through) |
| `test_job_models.py` | A job never downloads models: `require_job_models()` (Whisper first, then diarization, then the alignment model of an explicit language), `run_job` checks before the pipeline, the queue fails the job with `whisper_model_missing` / `diarization_model_missing`, the pipeline child sets `HF_HUB_OFFLINE=1` before loading models |
| `test_pipeline_process.py` | `run_pipeline_process()`: progress relayed, result returned, cancel stops the child at once (also mid-step and before start), `on_progress` errors stop it, child errors / missing alignment model / crash mapped to exceptions, SIGTERM from outside = interruption; group signals do not reach the child, the child exits when the backend dies; the real worker with a fake pipe; `Transcript` with embeddings survives pickling |
| `test_openapi_schema.py` | The committed API schema matches the code; the queue events are in it |
| `test_nltk_data.py` | Alignment offline: `scripts/fetch_nltk_data.py` is pinned to a commit + sha256, installs `punkt_tab` under `<prefix>/nltk_data/tokenizers`, refuses a wrong checksum or members outside `punkt_tab/` (nothing installed), replaces old data, reuses a valid cached archive and re-downloads a corrupt one; `use_bundled_nltk_data()` limits NLTK to `<sys.prefix>/nltk_data` and turns downloads into `NltkDataMissingError` naming the data and the fix (missing NLTK is fine); the pipeline child calls it before loading models |
| `test_telemetry.py` | Third-party telemetry off: `import app` sets `PYANNOTE_METRICS_ENABLED`, `OTEL_SDK_DISABLED`, `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` and overrides the user's values, whichever app module is imported first; the spawned pipeline child inherits them; with the real libraries (skipped in CI) pyannote exports no metrics and `huggingface_hub` sees telemetry disabled; `disable_onnxruntime_telemetry()` calls onnxruntime's switch (missing onnxruntime is fine) and the pipeline child calls it before loading models |
| `test_transcript_builder.py` | `TranscriptBuilder.build()` (WhisperX output → Transcript, UUID for unmatched `SPEAKER_XX`, `UNKNOWN` → unassigned) and `attach_embeddings()` (time-overlap matching) |
| `test_download_progress.py` | WS byte-level progress stream, polling loop, `done`/`error` events |
| `test_audio_store.py` | `import_audio()` (unique copy, extension, live recording kept, symlink followed, no partial copy on error), `is_import_copy()`, `discard_import()`, `discard_owned_audio()` (copies and live recordings, never files outside `recordings/`, symlink targets kept), both with the audio's waveform levels, `remove_orphan_imports()` (levels left alone), `remove_orphan_levels()`, `save_recording()` (live recording named `sonorus-rec-*`, format whitelist, empty body rejected, nothing left on failure) |
| `test_recordings_api.py` | `POST /audio/recordings`: stored in the backend's `RECORDINGS_DIR` by `Content-Type` (webm/wav), `415` for other types, `400` for an empty body |
| `test_quality_metrics.py` | Helpers of the quality tests (`tests/quality/`, see [Quality tests](quality.md)): text normalisation (fillers, hyphens), WER and word alignment, hyp → ref speaker mapping by time overlap, speaker accuracy, utterances and missed utterances, RMS level, cosine, recognition counts; AMI annotations: timed words, meeting speakers, clip-window reference, speech gate |
| `test_audio_capture.py` | `AudioCaptureService` start/stop/merge, `has_active_jobs()`, recordings dir, stderr-deadlock regression, `/audio/capture/*` routes; platform drivers: Linux `parec` command, Linux sources (default first, output devices named from `pactl -f json list sinks`, text fallback for old pactl, `LC_ALL=C`, name when no description), default monitor source without `pactl`, start errors (no `parec`, vanished source, process exiting at start), per-OS empty-capture messages; loudness levelling: ffmpeg commands for system-only and mic + system, fallback without levelling when ffmpeg fails, and on real ffmpeg (skipped without it) quiet and loud tracks end up within 6 dB, compressed and peaky tracks match in loudness, silence and faint noise are not boosted, a loud mix does not clip. `parec` is faked on `PATH` and `pactl` is absent by default, so no test depends on the machine's audio devices; capture files go to `tmp_path`; Windows driver against a real fake helper process (`tests/capture_workers.py`): sources from `--list` (default first), start errors (no helper, no output device, vanished device, helper failing before `READY`), stop through stdin without SIGINT, full API round trip; macOS/Linux still stop with SIGINT; helper path per platform |
| `test_logger.py` | `setup_logging()`, `get_logger()`, `LOG_LEVEL` env var, file logging |
| `test_transcribe_schema.py` | `TranscribeRequest` schema validation, optional `whisper_model` and `language` fields |
| `test_embedding_persistence.py` | Per-segment embedding round-trip through `save()` / `load()` |
| `test_model_cancel.py` | `cancel_event` in `download_model()`, `DELETE /models/{id}/download/{job_id}`, WS `cancelled` event |
| `test_speaker_candidates.py` | `rank_candidates()` and `voice_centroid()`: order, limit, rounding, negative similarity, the suggestion threshold |
| `test_waveform.py` | Waveform levels: `bar_levels()` (scale of the loud part of the recording, mean power, silence and past the end of the audio, clips, bars narrower than a window), the `.levels` cache next to the audio (computed once, also with two requests at once, a broken cache computed again, none on failure, none for audio outside `recordings/`), `compute_levels()` with the real ffmpeg (skipped without it) and without one |
| `test_voice_sample.py` | `pick_voice_sample()`: closest to the voice profile, longest fallback, ≥ 2 s preference, missing audio files skipped |
| `test_embedding_service.py` | `EmbeddingService.extract_all()` single-pass invariant |
| `test_version.py` | `get_version()`: `SONORUS_VERSION` wins over `package.json`, blank env ignored, missing / broken / version-less `package.json` → `unknown`, the repo's `package.json` by default; OpenAPI `info.version` is the product version |
| `test_testing_docs.py` | This page: every test file has exactly one row in the coverage table, no row for a missing file, no test-count column |
| `tests/electron/app-version.test.js` | The main process answers `get-app-version`, preload exposes `getAppVersion`, the backend gets `SONORUS_VERSION` |
| `tests/build/packaged-deps.test.js` | Lock files for every build platform (`BUILD_TARGETS`): every package pinned with a hash, direct dependencies match `requirements.packaged.txt` (no `+cpu` on macOS), no CUDA packages, no `EXCLUDED_PACKAGES` (normalized names, none the backend needs), PyTorch CPU index named; `oversized()` installer size check; the cached Python tarball is filtered out of the installers; no pip / `python-packages` in `backend.js`, no setup screen, IPC or preload API |
| `tests/build/gpu-manifest.test.js` | GPU manifests (`locks/gpu-*.json`) for Linux and Windows only; cu128 build of the bundled `torch` / `torchaudio` (and of `torchvision`, which the installer leaves out), driver 570 and compute capability 7.0 minimums; only CUDA-family packages that differ from the CPU lock; every wheel with https URL, sha256 and size, `total_size`; `gpuRequirements()`, `gpuConstraints()`, `parsePylock()`, `pickWheel()`, `buildGpuManifest()` (keeps only changed packages, `HEAD` size when missing, skips excluded packages, refuses drift outside the CUDA family); `copyGpuManifest()` ships the manifest and removes a stale one on macOS |
| `tests/electron/gpu-pack.test.js` | `electron/gpu-pack.js`: `applyPendingOps()` (nothing, removal, finished download replaces the pack as `unchecked`, unfinished download cleared), `prepareGpuStart()` (no pack, new pack checked and used / failed check recorded, checked pack used without a check, app update checks again, error or stale pack neither used nor checked, removal applied), `markPackError()`, `gpuBackendEnv()` (pack on `PYTHONPATH` only when used), `gpuSupported()`, `runProbe()` with `node` stand-ins (passing / failing JSON, crash with exit code and stderr, timeout, missing interpreter) |
| `tests/electron/backend-identity.test.js` | `electron/backend-identity.js`: `devUserDataPath()` (dev → `sonorus-dev`, packaged and `--user-data-dir` keep the default), `servesDataDir()` (trailing separator, case ignored on macOS/Windows only, no `data_dir` → not ours), `reuseDecision()` (nothing → spawn; packaged reuses only its own data dir and refuses dev, another packaged dir, an older backend or another program with a message naming the port and the dir; dev reuses a manual `uvicorn` and refuses the packaged backend or another program) |
| `tests/electron/dialog-folder.test.js` | `dialogFolder()` / `rememberDialogFolder()` (`electron/dialog-folder.js`): nothing saved, folder of the picked file kept on disk, a later pick replaces it, deleted folder or damaged file → OS decides; `main.js` passes it as `defaultPath` and remembers the pick |
| `tests/electron/system-audio-path.test.js` | No window-side system audio in `electron/` or `ui/src`: no `getDisplayMedia`, `setDisplayMediaRequestHandler`, `desktopCapturer`, `__desktop__`, `display-capture` |
| `tests/electron/no-third-party-requests.test.js` | `electron/main.js` turns spell checking off in the window and the session and sets no spell checker languages before the backend starts (no dictionary download from Google); no `crashReporter` and no remote URLs (other than the local backend) in `electron/` |
| `tests/e2e/home.test.js` | End to end, empty library: the empty state of the sidebar and the centre, its Settings link opens Settings on Models |
| `tests/e2e/import-queue.test.js` | End to end: a file from the (stubbed) file dialog goes into the paused queue with the default model, its title changes in Transcription settings, Delete from queue removes the job and keeps the original file |
| `tests/e2e/editor.test.js` | End to end: the newest recording opens at start; Play moves the clock; a turn changes speaker and back with Undo; the title changes in the editor and the list; a paragraph's text is edited and saved |
| `tests/e2e/speakers.test.js` | End to end: a speaker renamed in the Speakers window has the new name in the transcript |
| `tests/e2e/settings.test.js` | End to end: the interface scale zooms the window and is saved in `settings.json`; Reset preferences puts it back to 100 % |
| `tests/build/nltk-data.test.js` | `bundle-backend.js` installs `punkt_tab` with the bundled Python after pip, archive cached in `backend-dist/` and left out of the installers (`!*.zip`); `check-bundled-imports.js` loads it for every WhisperX language with NLTK limited to the bundled data |
| `tests/build/bundle-prune.test.js` | `pruneSitePackages()` removes library test suites, `torch/include` and the torch test programs, keeps `torch_shm_manager`, `torch/testing`, `numpy/testing` and regular modules, returns the bytes removed; `check-bundled-imports.js` imports the API, the pipeline and its libraries and checks every excluded package and that third-party telemetry is off (incl. the onnxruntime switch); every CI build job runs it right after bundling |
| `tests/build/vc-runtime.test.js` | Windows build ships the Visual C++ runtime: `VC_RUNTIME_DLLS` covers `msvcp140*`, `vcruntime140*`, `concrt140`, `vcomp140`; `copyVcRuntime()` copies them next to `python.exe` (replacing the archive's `vcruntime140*.dll`) and fails naming the missing DLLs and the Redistributable; `main()` copies from `System32` on Windows |
| `tests/build/electron-version.test.js` | Electron 38+ in `package.json` and `package-lock.json` (native Wayland by default, needed for drops from Wayland file managers), no ozone workarounds in `electron/`, no stale `allowScripts` entry for Electron, clipboard writes awaited in the main process |
| `tests/build/capture-helper.test.js` | Windows capture helper: source in `native/windows/`, shipped as `win/sonorus-capture.exe` (`extraResources`), built by `build:win` and CI `build-win` before electron-builder, compiled with mingw-w64 in the CI test job; MSVC command links the C runtime statically, mingw command is static + Unicode; an existing helper is kept without a compiler only if not older than its source; `backend.js` passes the path; binary gitignored |
| `tests/build/app-icons.test.js` | App icons: `package.json` points macOS, Windows and Linux at their icon; the macOS master has its plate at 824 with margin 100, the Windows / Linux master at 896 with margin 64 (8 px up); `icon.icns` has 128–1024 px images and its 1024 px image equals the macOS master; `icon.ico` has 16, 24, 32, 48 and 256 px images with the plate where the Windows / Linux master has it |

---

## File structure

Every `test_*.py`, `electron/`, `build/` and `e2e/` test file is listed in [Current coverage](#current-coverage); the tree shows the shared helpers.

```
tests/
├── conftest.py                        # ML library stubs, no-network downloads
├── download_workers.py                # App-free stand-ins for subprocess download workers
├── pipeline_workers.py                # App-free stand-ins for the pipeline child process
├── capture_workers.py                 # App-free stand-in for the Windows capture helper (sonorus-capture.exe)
├── queue_helpers.py                   # Stand-in pipeline runner + wait_for for queue tests
├── test_*.py                          # Python unit and API tests
├── electron/*.test.js                 # node:test tests of the Electron main process
├── build/*.test.js                    # node:test tests of the packaging inputs
└── e2e/
    ├── seed.py                        # Data directory with recordings, speakers and stand-in models
    ├── harness.js                     # Backend + Electron on that directory, through Playwright
    └── *.test.js                      # End-to-end scenarios (npm run test:e2e)
```

---

## Design conventions

- No ML models are loaded — all heavy calls (`snapshot_download`, `whisperx.load_model`, etc.) are patched via `unittest.mock`.
- Database tests use `tmp_path` (pytest fixture) — each test gets an isolated SQLite file.
- API tests use `TestClient` with `app.dependency_overrides` to inject in-memory services.
- Model directory constants (`config.WHISPER_MODELS_DIR`, `config.HF_MODELS_DIR`, `config.ALIGNMENT_MODELS_DIR`) are patched per-fixture to avoid touching the real model cache.
- A new test file needs a row in [Current coverage](#current-coverage) — `test_testing_docs.py` enforces it.
