---
sidebar_position: 2
---

# Speaker Memory Service

`SpeakerMemoryService` provides persistent speaker identity across sessions.

Diarization produces unstable IDs (`SPEAKER_00`, `SPEAKER_01`) that change from recording to recording. This service matches them against known voice profiles in persistent memory and returns stable IDs.

**Key contracts:**
- `resolve()` is a pure function — it never writes to memory
- Memory is only written via `CommitService.commit()`

---

## Storage

Data is stored in SQLite (`speaker_memory.db`). The service manages four tables:

```sql
CREATE TABLE speaker_embeddings (
    id        TEXT PRIMARY KEY,        -- always a UUID4
    embedding BLOB NOT NULL,           -- float32, little-endian
    count     INTEGER NOT NULL DEFAULT 1
)

CREATE TABLE speaker_names (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    speaker_id TEXT NOT NULL,          -- no FK since schema v2: a name may exist before any embedding
    label      TEXT NOT NULL,          -- e.g. "display"
    name       TEXT NOT NULL           -- not unique: two people may share a name
)

CREATE TABLE speaker_meta (
    speaker_id    TEXT PRIMARY KEY,
    color_index   INTEGER NOT NULL DEFAULT 0,  -- palette slot 0..4 (schema v3)
    handle        TEXT,                        -- @ivan.petrov without the @; only for named speakers (schema v4)
    handle_manual INTEGER NOT NULL DEFAULT 0   -- 1: set by hand, stays when the name changes (schema v4)
)
CREATE UNIQUE INDEX speaker_meta_handle ON speaker_meta (handle COLLATE NOCASE)

CREATE TABLE _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
)
```

> The table was historically named `speakers` — `_init_db()` automatically renames it to `speaker_embeddings` if the old name is found.

Every row of `speaker_meta` is written as an upsert of its own columns: a colour save never wipes the handle, nor a handle save the colour. Handles are unique through the index, not through the in-memory state, since the API and a pipeline job each hold their own instance. `_meta` also keeps the handle format (`handle_format`).

Runtime in-memory state:
```python
known_speakers = {
    "550e8400-e29b-41d4-a716-446655440000": np.array([...], dtype=float32),
}

known_names = {
    "550e8400-e29b-41d4-a716-446655440000": {"display": "Alice"},
}
```

---

## ID formats

| Format | Source | Description |
|---|---|---|
| UUID4 | `resolve()` (new voices), `create_named_speaker()` | All current speaker IDs |
| `person_N` | Legacy / imported | Old records from previous versions; migrated to UUID4 on startup |

---

## Methods

### `__init__(db_path="speaker_memory.db", threshold=0.75)`

Initialises the database (creates tables if missing), runs migrations, and loads known speakers.

**Parameters:**
- `db_path` — path to the SQLite file
- `threshold` — minimum cosine similarity for a match (recommended: `0.75`)

---

### `resolve(new_embeddings) → dict`

Matches new speakers against known ones using **exclusive greedy matching**.

**Algorithm:**
1. Computes cosine similarity between each new speaker and each known speaker
2. Sorts all pairs by score (descending)
3. Assigns top-down: each known speaker is claimed by at most one new speaker
4. New speakers without a match above `threshold` receive a new UUID4

**Input:**
```python
{
    "SPEAKER_00": np.array([...]),
    "SPEAKER_01": np.array([...])
}
```

**Output:**
```python
{
    "SPEAKER_00": "550e8400-...",   # matched from memory
    "SPEAKER_01": "6ba7b810-..."   # new speaker
}
```

**Important:** this method never modifies `self.known_speakers`. Only `CommitService.commit()` may update memory.

---

### `update_embedding(spk_id, embedding, count=None)`

Updates or registers a speaker embedding. Marks the speaker dirty so `save()` will persist it.

The only correct way to write to `known_speakers` from outside the service.

---

### `get_name(spk_id, label="display") → str | None`

Returns the speaker's name for the given label from `known_names`. Returns `None` if no name is set.

---

### `set_name(spk_id, name, label="display")`

Writes a name to `known_names` and marks the speaker's names dirty (in memory only, until `save()` or `save_names_only()` is called).

---

### `save()`

Persists dirty embeddings and dirty names to SQLite in one transaction.

Dirty tracking:
- only speakers touched by `update_embedding()` since the last `save()` are written to `speaker_embeddings`;
- only names changed by `set_name()` since the last save are written to `speaker_names`, and only for speakers that have an embedding.

This prevents a long-lived instance with stale in-memory state from overwriting data written by another instance. In particular, the pipeline job holds its own instance for the whole transcription; without name dirty tracking its final `save()` reverted speaker renames made in the UI while the job was running.

Called only from `CommitService`.

---

### `save_names_only()`

Persists names changed by `set_name()` since the last save (including speakers without an embedding) to `speaker_names` without touching `speaker_embeddings`. Each of those speakers whose handle was not set by hand then gets the handle made from the new name. Called from `PATCH /speakers/{id}`, `POST /speakers/{id}/rename` and the assign-by-name path.

---

### Handles

What a handle is and how one is made: [Speaker handles](../api/endpoints.md#speaker-handles). The generator is `app/services/speaker_handle.py`, pure functions.

- `get_handle(spk_id) → str | None`, `is_handle_manual(spk_id) → bool` — from `known_handles`, loaded with the other state.
- `set_handle(spk_id, handle | None)` — a handle set by hand, normalized (no `@`, lowercase), or with `None` the one made from the name again. Raises `InvalidHandle`, `HandleTaken` (with `owner_id`) or `HandleNeedsName`.
- `check_handle(text, exclude_id=None) → str` — the handle `text` stands for if it is valid and free; raises like `set_handle()`. The API calls it before anything is written.
- `suggest_handle(name, exclude_id=None) → str` — the handle a name gives now, numbered if taken.
- `get_handle_format()` / `set_handle_format(fmt)` — one of `HANDLE_FORMATS`, otherwise `ValueError`.

A handle is written by `SpeakerRepository.write_handle()` in one `BEGIN IMMEDIATE` transaction that reads the handles taken and writes the new one, so two writers cannot take one handle.

---

### `find_by_name(name, label="display") → str | None`

Returns the speaker UUID for the given display name, or `None` if not found. Names are not unique, so with several matches it returns one of them.

---

### `speaker_ids() → set[str]`

Every speaker memory knows about: with a voice profile (`known_speakers`), a name (`known_names`), or both. `GET /speakers` adds speakers that only have segments.

---

### `get_color_index(spk_id) → int | None` / `set_color(spk_id, color_index)`

Read / persist the palette slot. `set_color()` raises `ValueError` outside `0..PALETTE_SIZE-1` and writes `speaker_meta.color_index` immediately. Called from `PATCH /speakers/{id}` and from `POST /transcripts/{id}/speaker-assignments` when it creates a speaker by name with `color_index`.

---

### `remove_speaker(spk_id)`

Removes a speaker — embedding, names, color and handle — from memory (including pending dirty entries) and from the database. Works for speakers that only have a name; no-op if the speaker is unknown.

Called only through `CommitService`: `recompute_or_remove()` drops unnamed speakers left without segments, and `delete_speaker()` removes a speaker the user deleted (after its segments were unassigned).

---

### `clear() → int`

Deletes every speaker — named ones included — from `speaker_embeddings`, `speaker_names` and `speaker_meta`, and resets `known_speakers`, `known_counts`, `known_names`, `known_colors`, `known_handles` and all dirty sets, so a later `save()` / `save_names_only()` cannot restore anything. Every handle is free again. `_meta` (schema version, migration flags, the handle format) is kept. Returns the number of speakers removed. Used only by `POST /data/reset`.

---

### `_init_db()`

Creates `speaker_embeddings`, `speaker_names`, and `_meta` tables if missing and runs the schema migrations up to v4 (`speaker_meta.handle`, `handle_manual` and the unique index). Runs migration `m001_uuid_speakers`: converts any legacy human-name speaker ID to a UUID4, stores the original name in `speaker_names`, and updates all `segments.speaker_id` references. Then every named speaker without a handle gets one in the handle format, the one heard first (earliest transcript of their segments) first, so they keep the handle without a number; speakers without segments come last, by id. On an upgrade to v4 that gives every named speaker a handle; afterwards it finds none to do.

---

### `create_named_speaker(name, label="display", handle=None) → str`

Creates a new UUID4 speaker ID, sets its display name and persists it via `save_names_only()`, which gives it the handle made from the name. A `handle` given is checked first (nothing is created if it is refused) and then set by hand. Does not write an embedding: `CommitService` adds one once segments with embeddings are assigned to the new ID. Used by `POST /transcripts/{id}/speaker-assignments` (`speaker_name`).

---

## `threshold` parameter

| Value | Behaviour |
|---|---|
| `0.70` | Aggressive merging — different people may be collapsed |
| `0.75` | Balanced (recommended) |
| `0.80+` | Strict identification — more new IDs created |

`SPEAKER_SUGGESTION_THRESHOLD` (`0.5`) is a separate value and changes no matching: it only decides whether `GET /transcripts/{id}/speaker-candidates` marks the first candidate as suggested. It is lower because a voice above `threshold` is usually recognized by itself and never comes up for review.

---

## Position in the pipeline

```
EmbeddingService.extract_all()
    → aggregated_embeddings
    ↓
SpeakerMemoryService.resolve()
    → {"SPEAKER_00": "uuid-...", ...}
    ↓
TranscriptBuilder.build()
    → Transcript (speaker_resolved populated)

... after user review ...

CommitService.commit()
    → SpeakerMemoryService.update_embedding() + save()
```
