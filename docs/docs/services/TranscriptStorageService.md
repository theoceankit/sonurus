---
sidebar_position: 6
---

# Transcript Storage Service

`TranscriptStorageService` persists transcripts and segments to SQLite and provides an API for reading and updating them.

Used in two scenarios:
- **Write** — after the transcription pipeline (`save`)
- **Read** — when opening past recordings from the sidebar (`load`, `list_all`) and when reassigning speakers (`update_segments_speaker`, `update_segment_speaker`)

---

## Schema

```sql
CREATE TABLE transcriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file TEXT NOT NULL,
    language   TEXT,
    status     TEXT DEFAULT 'draft',
    created_at TEXT
)

CREATE TABLE segments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    transcription_id INTEGER NOT NULL REFERENCES transcriptions(id),
    speaker_id       TEXT,
    start            REAL NOT NULL,
    end              REAL NOT NULL,
    text             TEXT NOT NULL,
    speaker_raw      TEXT,
    embedding        BLOB
)
```

`speaker_id` — current effective speaker ID (`speaker_final or speaker_resolved`). Updated on reassign via `update_segments_speaker()` (bulk) or `update_segment_speaker()` (single segment).

`speaker_raw` — original diarization ID (`SPEAKER_00` etc.), stored for auditing and never changed.

`status` — transcript status: `'draft'` immediately after the pipeline.

`embedding` — per-segment pyannote embedding blob (float32). Used by `CommitService` after load.

---

## Methods

### `save(transcript) → int`

Inserts a row into `transcriptions` and all segments into `segments`. Sets `transcript.db_id`. Returns the new `id`.

```python
db_id = TranscriptStorageService().save(transcript)
```

**`speaker_id` logic per segment:**
```python
seg.speaker_final or seg.speaker_resolved
```

---

### `load(db_id) → Transcript`

Loads a full `Transcript` from the database by ID. Segments are ordered by ascending `start`.

```python
transcript = TranscriptStorageService().load(42)
```

---

### `list_all() → list[dict]`

Returns metadata for all transcripts for the sidebar, sorted by date (newest first).

Each item:

```python
{
    "id":       42,
    "title":    "output",          # filename without extension
    "section":  "Today",           # "Today" | "Yesterday" | "Last week" | "May 01, 2026"
    "status":   "draft",
    "duration": "12 min",          # or "1h 5m"
    "speakers": ["spk_abc", "spk_def"]
}
```

---

### `update_segments_speaker(db_id, from_spk, to_spk)`

Reassigns all segments of `from_spk` to `to_spk` within a single transcription.

```python
TranscriptStorageService().update_segments_speaker(42, "spk_fabc8834", "spk_new")
```

---

### `update_segment_speaker(db_id, start, end, new_speaker)`

Reassigns the speaker for a **single** segment identified by its start and end time.

```python
TranscriptStorageService().update_segment_speaker(42, 12.4, 17.8, "spk_new")
```

---

### `update_segment_text(db_id, start, end, new_text)`

Updates the text for a single segment identified by its time range.

---

### `delete_segment(db_id, start, end)`

Deletes a single segment identified by its time range.

---

### `delete(db_id)`

Deletes a transcription and all its segments.

---

### `update_status(db_id, status)`

Updates the `status` field in the `transcriptions` table.

```python
TranscriptStorageService().update_status(42, "finalized")
```

---

### `get_embeddings_by_speaker(spk_id) → list[np.ndarray]`

Returns all non-null embeddings for a speaker across all transcripts. Used by `CommitService` to recompute speaker embeddings from scratch.

---

### `_init_db()`

Creates tables if they do not exist. Runs migrations: adds the `status` column to `transcriptions` and the `embedding` column to `segments` if missing (for compatibility with older databases).

---

## Position in the pipeline

```
POST /transcribe (router)
    ↓
TranscriptStorageService.save(transcript)           ← write after pipeline

GET /transcripts (router)
    ↓
TranscriptStorageService.list_all()                 ← read for sidebar

GET /transcripts/{id} (router)
    ↓
TranscriptStorageService.load(db_id)                ← read when opening a recording

POST /transcripts/{id}/reassign (router)
    ↓
TranscriptStorageService.update_segments_speaker()  ← bulk reassign
```
