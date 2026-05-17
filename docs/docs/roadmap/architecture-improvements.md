---
sidebar_position: 2
---

# Architecture Improvements

Full audit of architecture and code quality. Identifies weaknesses with concrete remediation steps, organised by impact area. Implementation is intended to proceed iteratively — not as a single big-bang refactor.

Analysis covered the services, models, config, API layer, and tests/DB cross-cutting concerns.

---

## 1. Critical Issues

### ✅ 1.1 `CommitService` encapsulates speaker memory writes

**Done.** All embedding writes go through `CommitService`, which calls `self.memory.update_embedding(spk_id, emb)`. No direct writes to `known_speakers` elsewhere. `CommitService` now requires both `memory_service` and `storage_service` in its constructor and recomputes embeddings from all DB segments on every commit (recompute-from-scratch, not incremental averaging).

---

## 2. Scalability

### 2.1 New DB connection per operation

**Problem:** `TranscriptStorageService` opens and closes `sqlite3.connect()` inside every method (lines 35, 65, 74, 82, 90…). Under frequent UI operations (segment updates), this creates constant connection churn.

**Fix:** Accept single-connection-per-request as a deliberate choice (SQLite does not need pooling), but add `busy_timeout` and `PRAGMA journal_mode=WAL` to support concurrent readers without blocking.

**Files:** `app/services/transcript_storage_service.py`

---

### 2.2 No DB migration system

**Problem:** All migrations are `try/except sqlite3.OperationalError: pass` blocks inside `_init_db()`. No version tracking, no rollback, migration errors silently swallowed (lines 223–231).

**Fix:** Add a `schema_version` table with an incrementing integer. Each migration is a named method that runs only when `current_version < target_version`.

**Files:** `app/services/transcript_storage_service.py`, `app/services/speaker_memory_service.py`

---

### ✅ 2.3 Magic numbers extracted to `config.py`

**Done.** `app/config.py` exports: `DEVICE`, `WHISPER_MODEL`, `WHISPER_BATCH_SIZE`, `WHISPER_COMPUTE_TYPE_CUDA`, `WHISPER_COMPUTE_TYPE_CPU`, `EMBEDDING_SAMPLE_RATE`, `EMBEDDING_MIN_DURATION`, `SPEAKER_SIMILARITY_THRESHOLD`. All services import from config.

---

## 3. Code Readability

### ✅ 3.1 Device type standardised

**Done.** `app/config.py` exports `DEVICE: str = "cuda" if torch.cuda.is_available() else "cpu"`. All services import from config — no `torch.device` objects in call sites.

---

## 5. Services That Need Splitting

### 5.1 `TranscriptStorageService` (236 lines)

Currently does three things:
1. **Schema and migrations** — `_init_db()`
2. **Serialisation** — `_serialize_embedding()`, `_deserialize_embedding()`
3. **Repository** — `save()`, `load()`, `list_all()`, `update_*`

**Proposed split:**
- `app/db/schema.py` — schema creation and migrations
- `app/db/serializers.py` — numpy ↔ BLOB conversion
- `app/services/transcript_storage_service.py` — CRUD repository only

---

### 5.2 `SpeakerMemoryService` (162 lines)

Currently mixes:
1. **Storage** — `_load()`, `_load_names()`, `save()`
2. **Matching** — `resolve()`, cosine similarity
3. **Mutation** — `set_name()`, `known_speakers` as a public attribute

**Proposed split:**
- `SpeakerRepository` — SQLite I/O only
- `SpeakerResolver` — pure `resolve()` logic; takes `known_speakers` as a parameter
- `SpeakerMemoryService` — thin facade over the two above

---

### 5.3 Candidates for new dedicated services

| New service | Responsibility | Currently in |
|---|---|---|
| `ModelCleanupService` | `del model; gc.collect(); torch.cuda.empty_cache()` | `transcription_service.py`, `app/api/routers/transcription.py` |
| `MigrationRunner` | versioned DB migrations | `_init_db()` in both storage services |

---

## 6. Entry Point Hygiene

### 6.1 Consolidate warning suppression

**Problem:** `VERBOSE=false` warning suppression is spread across three locations with overlapping filters:

| Location | Suppresses |
|---|---|
| `main.py` | pyannote, lightning, whisperx, torch (CLI) |
| `app/api/main.py` | pyannote import-time warning (API startup) |
| `app/api/routers/transcription.py` → `_suppress_noise()` | pyannote, lightning, torch (inference thread) |

The `pyannote` filter appears in both `app/api/main.py` and `_suppress_noise()`. The split exists because the import-time warning must be suppressed before the module is loaded, while runtime warnings must be suppressed inside the worker thread — but the current structure makes it easy to miss one location when adding new suppression rules.

**Fix:** Extract a shared `app/warnings.py` module with a single `suppress_ml_noise()` function. Call it from all three entry points. Each call site passes a context flag (`"startup"` / `"thread"`) if the suppression scope differs.

**Files:** `main.py`, `app/api/main.py`, `app/api/routers/transcription.py`

---

## 7. Cross-Cutting Gaps

### ✅ 6.1 ML model load error handling

**Done.** `TranscriptionService` and `EmbeddingService` wrap model loading; errors surface as an `error` event over the WebSocket connection.

---

### ✅ 6.2 SQLite foreign keys enforced

**Done.** Both `TranscriptStorageService._connect()` and `SpeakerMemoryService._connect()` execute `PRAGMA foreign_keys=ON` on every connection. WAL mode (`PRAGMA journal_mode=WAL`) is set in `_init_db()`.

---

### ✅ 6.3 Dead code removed

**Done.** `SpeakerMemoryService._match_speaker()` has been removed.

---

## 7. Prioritisation

| Priority | Task | Effort | Risk | Status |
|---|---|---|---|---|
| P0 | Move magic numbers into `config.py` | S | Low | ✅ Done |
| P0 | Delete dead `_match_speaker` method | XS | Low | ✅ Done |
| P0 | FK constraints + WAL mode in SQLite | S | Low | ✅ Done |
| P1 | `CommitService` → encapsulate via method, no direct mutation | S | Medium | ✅ Done |
| P1 | Standardise device type to plain string | S | Low | ✅ Done |
| P1 | `ServiceFactory` for DI | M | Medium | ✅ Done |
| P1 | ML model load error handling | M | Medium | ✅ Done |
| P1 | Per-segment embedding persistence | S | Low | ✅ Done |
| P2 | Versioned DB migrations | M | Low | Pending |
| P2 | `TranscriptStorageService` → split schema/serialiser/repo | L | Medium | Pending |

Effort: XS < S < M < L < XL. Risk refers to regression risk during the refactor.
