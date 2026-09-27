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

Data is stored in SQLite (`speaker_memory.db`). The service manages three tables:

```sql
CREATE TABLE speaker_embeddings (
    id        TEXT PRIMARY KEY,        -- always a UUID4
    embedding BLOB NOT NULL,           -- float32, little-endian
    count     INTEGER NOT NULL DEFAULT 1
)

CREATE TABLE speaker_names (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    speaker_id TEXT NOT NULL REFERENCES speaker_embeddings(id),
    label      TEXT NOT NULL,          -- e.g. "display"
    name       TEXT NOT NULL
)

CREATE TABLE _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
)
```

> The table was historically named `speakers` — `_init_db()` automatically renames it to `speaker_embeddings` if the old name is found.

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

Persists names changed by `set_name()` since the last save (including speakers without an embedding) to `speaker_names` without touching `speaker_embeddings`. Called from `POST /speakers/{id}/rename` and the reassign-by-name path.

---

### `find_by_name(name, label="display") → str | None`

Returns the speaker UUID for the given display name, or `None` if not found.

---

### `remove_speaker(spk_id)`

Removes a speaker from memory and from the database. No-op if not present.

Called after a reassignment to clean up temporary unrecognized IDs that no longer have any segments.

---

### `clear() → int`

Deletes every speaker — named ones included — from `speaker_embeddings`, `speaker_names` and `speaker_meta`, and resets `known_speakers`, `known_counts`, `known_names`, `known_colors` and all dirty sets, so a later `save()` / `save_names_only()` cannot restore anything. `_meta` (schema version, migration flags) is kept. Returns the number of speakers removed. Used only by `POST /data/reset`.

---

### `_init_db()`

Creates `speaker_embeddings`, `speaker_names`, and `_meta` tables if missing. Runs migration `m001_uuid_speakers`: converts any legacy human-name speaker ID to a UUID4, stores the original name in `speaker_names`, and updates all `segments.speaker_id` references.

---

### `create_named_speaker(name, label="display") → str`

Creates a new UUID4 speaker ID, sets its display name and persists it via `save_names_only()`. Does not write an embedding: `CommitService` adds one once segments with embeddings are assigned to the new ID. Used by `POST /transcripts/{id}/reassign` (`to_speaker_name`) and `PATCH …/segments/{start}/speaker` (`speaker_name`).

---

## `threshold` parameter

| Value | Behaviour |
|---|---|
| `0.70` | Aggressive merging — different people may be collapsed |
| `0.75` | Balanced (recommended) |
| `0.80+` | Strict identification — more new IDs created |

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
