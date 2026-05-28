---
sidebar_position: 2
---

# Architecture Improvements

Full audit of architecture and code quality. Identifies weaknesses with concrete remediation steps, organised by impact area. Implementation is intended to proceed iteratively — not as a single big-bang refactor.

Analysis covered the services, models, config, API layer, Electron renderer, and tests/DB cross-cutting concerns.

---

## 1. API Layer

### 1.1 `PATCH /segments/{start}/speaker` — no input validation ⚠️ CRITICAL

**Problem:** The handler accepts `body.speaker_id` as-is with no UUID format check and no membership check against `memory.known_speakers`. The value is written directly to `segments.speaker_id`, and then `commit_speaker(body.speaker_id)` creates a row in `speaker_embeddings` under whatever string was passed — including a display name, an empty string, or any arbitrary value. Violates I5: "Display name is never stored as the ID."

The symmetrical `POST /reassign` endpoint correctly validates `to_speaker_id in memory.known_speakers`. The single-segment patch is the asymmetric weak point. `test_update_segment_speaker` currently passes `"Carol"` as speaker_id and asserts success — codifying the broken behaviour.

**Fix:** Validate that `body.speaker_id` matches UUID4 format **and** is present in `memory.known_speakers`; return 400 otherwise. Update the test.

**Files:** `app/api/routers/transcripts.py:69–88`, `tests/test_api.py`

---

### 1.2 `TranscriptListItem` schema silently drops `section` and `duration`

**Problem:** `storage.list_all()` returns dicts with `section` (date-group label) and `duration` (formatted length). The router maps each dict into `TranscriptListItem`, whose Pydantic schema only declares `id, title, created_at, status, speakers` — extras are silently dropped. The Electron renderer reads `item.section` for sidebar grouping and `item.duration` for display; both are always `undefined`, so the sidebar shows no group headers and no recording lengths. `docs/api/endpoints.md` explicitly documents these two fields.

**Fix:** Add `section: str` and `duration: str` to `TranscriptListItem`; include them in the router mapping.

**Files:** `app/api/schemas.py`, `app/api/routers/transcripts.py:15–26`, `electron/renderer/app.js`, `docs/docs/api/endpoints.md`

---

### 1.3 WebSocket disconnect does not stop the running transcription job

**Problem:** If the WS client disconnects, the handler pops the queue from `_jobs` in its `finally` block but the pipeline thread continues running. `_emit()` enqueues events onto the orphaned queue; they are never consumed. The transcript is written to disk, but the client never receives `done`/`error`. The recording appears in the sidebar on next refresh, masking the symptom and breaking the `AlignmentModelMissingError` recovery flow.

**Fix:** Call `cancel_event.set()` on WS disconnect, or buffer events to disk so a reconnecting client can recover state.

**Files:** `app/api/routers/transcription.py:88–93, 158–173`

---

### 1.4 Silent failure on diarization model download

**Problem:** Inside `download_model("diarize", ...)` a bare `except Exception: pass` swallows all exceptions from `snapshot_download`. The router then emits `{"type": "done"}` regardless, so the user sees a successful download even when nothing was fetched. The next transcription fails because `is_installed("diarize")` returns `False`.

**Fix:** Remove the blanket `except` (or re-raise after stopping the progress poller) so the router can emit `{"type": "error"}`.

**Files:** `app/services/model_service.py:302–304`, `app/api/routers/models.py`

---

### 1.5 HTTP status code inconsistency across model endpoints

**Problem:** `DELETE /models/{id}` and `POST /models/{id}/download` return 400 for an unknown model_id. `DELETE /models/{id}/download/{job_id}` returns 422 for the same condition. `docs/api/endpoints.md` documents 422 for all three.

**Fix:** Unify on 422 (matches FastAPI's standard for invalid path enum values); update `endpoints.md`.

**Files:** `app/api/routers/models.py:40, 50, 81`, `docs/docs/api/endpoints.md`

---

### 1.6 CORS `allow_origins=["*"]` not locked down

**Problem:** All origins, methods, and headers are allowed. For an Electron app hitting `localhost:8000`, the correct value is `["http://localhost"]` or `["file://"]`. Any local script that discovers the port can drive the full API.

**Fix:** Lock CORS to expected Electron origins before production/distribution.

**Files:** `app/api/main.py:31–36`

---

## 2. Service Layer

### 2.1 API singleton vs pipeline-thread `SpeakerMemoryService` diverge after transcription ⚠️ CRITICAL

**Problem:** The pipeline creates a fresh `SpeakerMemoryService` via `create_controller(...)` inside the worker thread, separate from the `lru_cache` singleton used by `GET /speakers`, `POST /reassign`, and rename endpoints. After the pipeline saves new speakers to disk, the API-layer singleton's `known_speakers` is stale. New speakers created during a transcription run are invisible to rename/reassign endpoints until uvicorn restarts.

**Fix:** After the pipeline completes, reload the API-layer singleton's `known_speakers` and `known_names` from disk. Or make `create_controller()` accept an existing `memory_service` so it reuses the API singleton directly.

**Files:** `app/services/service_factory.py:21–24`, `app/api/routers/transcription.py:105, 114`

---

### 2.2 `CommitService.recompute_or_remove()` accesses private `_load_names()` directly

**Problem:** `recompute_or_remove()` writes to `self.memory.known_names` via `self.memory._load_names()` — a private method — clobbering any uncommitted `set_name()` changes made by a concurrent request on the shared singleton. Violates Critical Rule 2 and the encapsulation boundary of `SpeakerMemoryService`.

**Fix:** Add a public `reload_names()` method on `SpeakerMemoryService`, or have the relevant check query the DB directly rather than refreshing in-memory state via a back door.

**Files:** `app/services/commit_service.py:60`

---

### 2.3 `TranscriptionController.commit()` is dead code with incorrect operation order

**Problem:** `TranscriptionController.commit()` calls `commit_service.commit(transcript)` **before** `storage_service.save(transcript)`. For a Fresh (unsaved) transcript, the commit sees an empty DB and is a no-op; segments are then saved but nothing lands in `speaker_embeddings`. The method is not called from any API path; the CLI (`main.py`) uses it and silently produces empty speaker embeddings.

**Fix:** Swap to save-then-commit to match the API path (`transcription.py:112–114`). Or remove the method and update `main.py` to call `CommitService` directly, if the controller is otherwise no longer needed.

**Files:** `app/controllers/transcription_controller.py:76–78`, `app/api/routers/transcription.py:112–114`

---

### 2.4 `create_controller()` opens hardcoded default `db_path`

**Problem:** Both `SpeakerMemoryService` and `TranscriptStorageService` inside `create_controller()` default to the relative path `"speaker_memory.db"`. Any call without an explicit `db_path` (i.e. the pipeline invocation in `transcription.py`) opens the default file even when tests or configs override the API singleton to a different DB path.

**Fix:** Read `db_path` from config/env and thread it into `create_controller()`.

**Files:** `app/services/service_factory.py`, `app/api/routers/transcription.py`

---

### 2.5 `update_segments_speaker` silently no-ops for raw `SPEAKER_XX` IDs

**Problem:** `update_segments_speaker(db_id, from_spk, to_spk)` matches on `segments.speaker_id = from_spk`. Since `speaker_id` stores UUIDs post-resolve, passing a raw diarization label (`"SPEAKER_00"`) matches nothing and the reassign silently does nothing.

**Fix:** In the reassign router, validate that `from_speaker_id` matches at least one segment's `speaker_id`; return 400 if not.

**Files:** `app/services/transcript_storage_service.py:68–75`, `app/api/routers/transcripts.py`

---

### 2.6 `_dirty` set replaced without a lock — concurrent write loss possible

**Problem:** `save()` snapshots and resets `self._dirty` with `dirty = self._dirty; self._dirty = set()`. If `update_embedding()` is called from another thread between the snapshot and the reset, the new addition lands in the fresh set but the ongoing `executemany` misses it. Currently safe because the API singleton and pipeline instance don't share `_dirty`, but becomes a real bug if §2.1 is fixed with a unified singleton.

**Fix:** Guard `_dirty` mutation with a `threading.Lock`; snapshot and reset under the lock.

**Files:** `app/services/speaker_memory_service.py:109, 134`

---

### 2.7 `find_by_name()` bypasses in-memory cache, may return stale data

**Problem:** `find_by_name(name)` opens a fresh DB connection on every call, ignoring `self.known_names` which already holds the same data. If `set_name()` was called but not yet flushed via `save_names_only()`, `find_by_name` returns stale results from the DB.

**Fix:** Look up `self.known_names` first; fall back to DB only if not found.

**Files:** `app/services/speaker_memory_service.py:247–254`

---

### 2.8 `resolve()` cosine similarity is unvectorized — O(N×M) Python loop

**Problem:** `resolve()` computes cosine similarity between each new-session speaker embedding and each known speaker one pair at a time inside a Python loop. For 5 session speakers × 50 known speakers = 250 individual sklearn calls. Vectorizing (stack known embeddings into a matrix, call `cosine_similarity` once) also opens the door to replacing the greedy argmax with Hungarian matching (I6 target state in `invariants.md`).

**Fix:** Stack known embeddings into a matrix; call `cosine_similarity` once per session speaker. Optionally replace greedy assignment with `scipy.optimize.linear_sum_assignment`.

**Files:** `app/services/speaker_memory_service.py:47–58`

---

### 2.9 `EmbeddingService.extract()` returns the aggregate format forbidden by Critical Rule 4

**Problem:** `EmbeddingService.extract()` and `extract_segments()` are public but unused in production (the pipeline calls `extract_all()`). `extract()` returns aggregated embeddings per speaker — exactly the format that Rule 4 forbids passing into `CommitService`. Keeping them public invites a future caller to misuse them in commit logic.

**Fix:** Rename to `_extract()` and `_extract_segments()` to mark them internal, or remove them entirely.

**Files:** `app/services/embedding_service.py:32–66`

---

### 2.10 Archive `.txt` uses raw UUIDs instead of display names in the API path

**Problem:** The API path calls `ArchiveService().archive(transcript)` without a `display_fn`, so the `.txt` transcript always shows `bf1ab35d-…: Hello.` instead of speaker names. The CLI path correctly passes `controller.get_display_name`.

**Fix:** Pass `display_fn = lambda spk: memory.get_name(spk) or spk` from the router.

**Files:** `app/services/archive_service.py`, `app/api/routers/transcription.py:115`

---

## 3. Scalability

### 3.1 New DB connection per operation

**Problem:** Both `TranscriptStorageService` and `SpeakerMemoryService` open and close a `sqlite3.connect()` inside every method. WAL mode and a 30-second timeout are already configured in `_init_db()` / `_connect()`, so correctness is not at risk. The churn is still significant under frequent UI operations (segment-by-segment edits).

**Fix:** Accept single-connection-per-request as a deliberate choice, but validate that `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout` are consistently applied (WAL confirmed; `busy_timeout` pragma is absent — only the Python-level `timeout=30` is set, which blocks the GIL rather than yielding).

**Files:** `app/services/transcript_storage_service.py`, `app/services/speaker_memory_service.py`

---

### 3.2 No DB migration system

**Problem:** All migrations are `try/except sqlite3.OperationalError: pass` blocks inside `_init_db()`. No version tracking, no rollback, migration errors silently swallowed in both storage services.

**Fix:** Add a `schema_version` table with an incrementing integer. Each migration is a named method that runs only when `current_version < target_version`.

**Files:** `app/services/transcript_storage_service.py`, `app/services/speaker_memory_service.py`

---

### 3.3 `ThreadPoolExecutor` and job-state dicts are module-level globals

**Problem:** `_executor = ThreadPoolExecutor(max_workers=1)` is created at module import and never shut down across `lifespan` cycles or test runs. `_jobs` / `_cancel_events` / `_download_jobs` dicts have no TTL or lifecycle cleanup — orphaned entries accumulate if a job finishes before a WS client connects. The same pattern exists in `models.py`.

**Fix:** Wrap executor + job state in a `JobManager` class; instantiate it inside the FastAPI `lifespan` and store on `app.state`; shut down the executor in lifespan teardown. Add TTL-based GC for orphaned entries.

**Files:** `app/api/routers/transcription.py:45–50`, `app/api/routers/models.py:16–21`, `app/api/main.py`

---

## 4. Services That Need Splitting

### 4.1 `TranscriptStorageService`

Currently does three things:

1. **Schema and migrations** — `_init_db()`
2. **Serialisation** — `_serialize_embedding()`, `_deserialize_embedding()`
3. **Repository** — `save()`, `load()`, `list_all()`, `update_*`

**Proposed split:**
- `app/db/schema.py` — schema creation and migrations
- `app/db/serializers.py` — numpy ↔ BLOB conversion
- `app/services/transcript_storage_service.py` — CRUD repository only

---

### 4.2 `SpeakerMemoryService`

Currently mixes:

1. **Storage** — `_load()`, `_load_names()`, `save()`
2. **Matching** — `resolve()`, cosine similarity
3. **Mutation** — `set_name()`, `known_speakers` as a public attribute

The backdoor via `_load_names()` in `CommitService` (see §2.2) is a direct consequence of this mixed responsibility — `CommitService` reaches into storage internals because there is no clean resolver boundary.

**Proposed split:**
- `SpeakerRepository` — SQLite I/O only
- `SpeakerResolver` — pure `resolve()` logic; takes `known_speakers` as a parameter
- `SpeakerMemoryService` — thin facade over the two above

---

### 4.3 Candidates for new dedicated services

| New service | Responsibility | Currently in |
|---|---|---|
| `ModelCleanupService` | `del model; gc.collect(); torch.cuda.empty_cache()` | `transcription_service.py:66,97–98`, `routers/transcription.py:120–121` |
| `MigrationRunner` | versioned DB migrations | `_init_db()` in both storage services |

---

## 5. Entry Point Hygiene

### 5.1 Consolidate warning suppression

**Problem:** `VERBOSE=false` warning suppression is spread across three locations with overlapping filters:

| Location | Suppresses |
|---|---|
| `main.py:15–17` | pyannote, lightning, torch (CLI) |
| `app/api/main.py:13` | pyannote import-time warning (API startup) |
| `app/api/routers/transcription.py:33–35` `_suppress_noise()` | lightning, pyannote, torch (inference thread) |

The `pyannote` filter appears in both `app/api/main.py` and `_suppress_noise()`. The split exists because import-time warnings must be suppressed before the module loads, while runtime warnings must be suppressed inside the worker thread — but the current structure makes it easy to miss a location when adding new rules.

**Fix:** Extract a shared `app/warnings.py` module with a single `suppress_ml_noise(context)` function. Call it from all three entry points with a `"startup"` / `"thread"` context flag.

**Files:** `main.py`, `app/api/main.py`, `app/api/routers/transcription.py`

---

### 5.2 `WHISPER_COMPUTE_TYPE_CUDA` requires Turing+ GPU — no startup guard

**Problem:** `config.py` sets `DEVICE = "cuda"` when CUDA is available, but `WHISPER_COMPUTE_TYPE_CUDA = "int8_float16"` requires Turing architecture (Compute Capability ≥ 7.5). On older CUDA GPUs this fails at WhisperX model load, late in the startup sequence, with an obscure ctranslate2 error.

**Fix:** At startup, detect GPU compute capability with `torch.cuda.get_device_capability()` and fall back to `"float16"` if `int8_float16` is unsupported.

**Files:** `app/config.py`

---

## 6. Electron Frontend

### 6.1 Model catalog hardcoded in `data.js`

**Problem:** `electron/renderer/data.js` ships a static `MODELS` catalog and merges install status from `GET /models` at settings-view render time. If the backend adds or renames a model, the UI won't reflect it until `data.js` is updated manually.

**Fix:** Fetch the full catalog from `GET /models` and drive the settings view entirely from the API response, removing the static catalog from the renderer.

**Files:** `electron/renderer/data.js`, `electron/renderer/views/settings-view.js`

---

### 6.2 "Unknown N" display index is unstable across reloads

**Problem:** `editor-view.js` derives the "Unknown N" label index from the order speakers first appear in `transcript.segments` at render time. If segments are reordered or the transcript is reloaded, the same physical speaker can change index — "Unknown 1" on one load, "Unknown 2" on the next.

**Fix:** Assign a stable per-transcript ordinal at save time (e.g. in the DB), or derive from a deterministic sort (first segment `start` time, ascending).

**Files:** `electron/renderer/views/editor-view.js:787–797`

---

## 7. CLI Removal

The CLI interface (`main.py` + `app/cli.py`) is a legacy entry point that predates the Electron UI. It is not actively maintained, contains a known correctness bug (§2.3 — `commit()` order), and will be replaced by a purpose-built CLI in the future. The current code should be removed to reduce the maintenance surface.

### 7.1 Delete `main.py` and `app/cli.py`

**Files to delete:** `main.py`, `app/cli.py`

These are the CLI entry point and its interactive view. Removing them eliminates the broken `_handle_save` path and the warning suppression duplication in `main.py` (§5.1).

---

### 7.2 Slim down `TranscriptionController` after CLI removal

After removing `app/cli.py`, the following `TranscriptionController` methods lose all callers and become dead code:

| Method | Only caller |
|---|---|
| `reassign_speaker()` | `cli.py:108` |
| `reassign_all_by_speaker()` | `cli.py:106` |
| `create_new_speaker()` | `cli.py:90` |
| `get_all_known_speakers()` | `cli.py:70` |
| `rename_speaker()` | `cli.py:93, 145` |
| `commit()` | `cli.py:117` |

Remaining live methods: `run_pipeline()` (called by the API router) and `get_display_name()` (used for the archive fix in §2.10).

**Options:**
- **Delete the dead methods** and keep `TranscriptionController` as a thin `PipelineRunner` wrapper.
- **Dissolve the controller entirely** — move `run_pipeline()` inline into the router and call `memory.get_name()` directly for the archive `display_fn`.

**Files:** `app/controllers/transcription_controller.py`, `app/api/routers/transcription.py`

---

## 8. Dead Code Cleanup

### 8.1 `EmbeddingService.extract()` — no callers

`extract()` returns per-speaker aggregated embeddings — the exact format that Critical Rule 4 forbids passing into `CommitService`. It has zero callers in production code. Keeping it public invites future misuse.

**Fix:** Delete the method.

**File:** `app/services/embedding_service.py:39–42`

---

### 8.2 `EmbeddingService.extract_segments()` — internal only

`extract_segments()` is only called by `extract_all()` within the same class. The single external reference is a docstring in a test (`test_transcript_builder.py:29`), not an actual call.

**Fix:** Rename to `_extract_segments()` to make the internal-only contract explicit.

**File:** `app/services/embedding_service.py:44–66`

---

### 8.3 `TranscriptionController.resolve_display_name_to_id()` — no callers

Zero callers anywhere in production or test code. The method duplicates `SpeakerMemoryService.find_by_name()` but only searches the in-memory `known_names` dict, making it weaker than the DB-backed alternative.

**Fix:** Delete the method.

**File:** `app/controllers/transcription_controller.py:63–67`

---

## 9. Prioritisation

| Priority | Task | Effort | Risk | Status |
|---|---|---|---|---|
| P0 | `PATCH /segments/.../speaker` — UUID + membership validation (§1.1) | S | Low | Done |
| P0 | `TranscriptListItem` add `section` + `duration` (§1.2) | S | Low | Done |
| P0 | Silent diarization download failure — remove bare `except` (§1.4) | S | Low | Done |
| P0 | Delete `main.py` + `app/cli.py` (§7.1) | XS | Low | Done |
| P0 | Dead code: `EmbeddingService.extract()`, `resolve_display_name_to_id()` (§8.1, §8.3) | XS | Low | Done |
| P1 | API singleton / pipeline `SpeakerMemoryService` divergence (§2.1) | M | Medium | Done |
| P1 | `CommitService` backdoor into `_load_names()` (§2.2) | S | Low | Done |
| P1 | Slim down `TranscriptionController` after CLI removal (§7.2) | S | Low | Done |
| P1 | Archive `.txt` UUID display fix (§2.10) | S | Low | Done |
| P1 | `ThreadPoolExecutor` / job-state bound to app lifecycle (§3.3) | M | Medium | Done |
| P2 | Versioned DB migrations (§3.2) | M | Low | Done |
| P2 | `_dirty` set lock for thread safety (§2.6) | S | Low | Done |
| P2 | HTTP status code consistency 400→422 (§1.5) | XS | Low | Done |
| P2 | WS disconnect → cancel running job (§1.3) | M | Medium | Done |
| P2 | `create_controller()` db_path from config (§2.4) | S | Low | Done |
| P2 | `EmbeddingService.extract_segments()` → `_extract_segments()` (§8.2) | XS | Low | Done |
| P3 | Vectorize cosine similarity in `resolve()` (§2.8) | M | Low | Done |
| P3 | `find_by_name()` in-memory cache lookup first (§2.7) | XS | Low | Done |
| P3 | `update_segments_speaker` validate `from_spk` (§2.5) | S | Low | Done |
| P3 | `TranscriptStorageService` → split schema/serialiser/repo (§4.1) | L | Medium | Done |
| P3 | CORS lock to Electron origins (§1.6) | XS | Low | Done |
| P4 | Consolidate warning suppression (§5.1) | S | Low | Done |
| P4 | CUDA compute capability guard at startup (§5.2) | S | Low | Done |
| P4 | Electron model catalog from API (§6.1) | M | Low | Done |
| P4 | Stable "Unknown N" ordinal (§6.2) | S | Low | Done |
| P4 | `SpeakerMemoryService` → split repo/resolver/facade (§4.2) | L | High | Done |

Effort: XS < S < M < L < XL. Risk refers to regression risk during the refactor.
