---
sidebar_position: 6
---

# Transcript Storage Service

`TranscriptStorageService` persists transcripts and segments to SQLite and provides an API for reading and updating them.

Used in two scenarios:
- **Write** — after the transcription pipeline (`save`)
- **Read** — when opening past recordings from the sidebar (`load`, `list_all`) and when assigning speakers (`set_segments_speaker`)
- **Notes** — the note of a recording (`get_note`, `save_note`, `delete_note`)
- **Speakers section** — usage statistics, a speaker's transcripts and voice-sample candidates (`speaker_stats`, `transcripts_for_speaker`, `speaker_segments`), detaching a deleted speaker (`unassign_speaker`) and moving a merged one (`move_speaker`)

---

## Schema

```sql
CREATE TABLE transcriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file TEXT NOT NULL,
    language   TEXT,
    status     TEXT DEFAULT 'draft',
    created_at TEXT,
    title      TEXT,                            -- schema v3
    opened     INTEGER NOT NULL DEFAULT 0       -- schema v7: 1 once the user has opened it
)

CREATE TABLE segments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    transcription_id INTEGER NOT NULL REFERENCES transcriptions(id),
    speaker_id       TEXT,
    start            REAL NOT NULL,
    end              REAL NOT NULL,
    text             TEXT NOT NULL,
    speaker_raw      TEXT,
    embedding        BLOB,
    unassigned       INTEGER NOT NULL DEFAULT 0  -- schema v5
)

CREATE INDEX idx_segments_transcription ON segments(transcription_id);  -- schema v4
CREATE INDEX idx_segments_speaker       ON segments(speaker_id);        -- schema v4

CREATE TABLE speaker_matches (                                          -- schema v8
    transcription_id INTEGER NOT NULL,
    speaker_id       TEXT NOT NULL,
    score            REAL NOT NULL,
    confirmed        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (transcription_id, speaker_id)
)

CREATE TABLE notes (                                                    -- schema v9
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    transcription_id INTEGER UNIQUE,
    content          TEXT NOT NULL,
    format           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
)
```

`speaker_id` — current effective speaker ID (`speaker_final or speaker_resolved`), always a UUID4 or `NULL`. Updated when segments get a speaker, via `set_segments_speaker()`.

`speaker_raw` — original diarization ID (`SPEAKER_00` etc.), stored for auditing and never changed. It is never used as a speaker: `TranscriptBuilder` gives unmatched diarization speakers their own UUID, and schema v6 did the same for rows stored earlier (one new UUID per transcript and raw label).

`unassigned` — `1` for a segment without a speaker: its speaker was deleted (`unassign_speaker()`), or diarization gave it none (`UNKNOWN`). `speaker_id` is then `NULL`; `load()` returns `Segment.unassigned = True`. Assigning a speaker (`set_segments_speaker()`) clears it.

`status` — transcript status: `'draft'` immediately after the pipeline.

`diarized` — `0` for a recording transcribed without looking for speakers, `1` for all others (schema v10).

`embedding` — per-segment pyannote embedding blob (float32). Used by `CommitService` after load.

`speaker_matches` — one row per speaker that `resolve()` recognized from memory when the transcript was made: `score` is the similarity of the match, `confirmed` is `1` once the user confirmed the speaker as a possible match. Speakers assigned by hand have no row, and nothing else writes one, so the similarity is never worked out again later (by then the profile contains this recording).

`notes` — the note of a recording: `content` is the editor's document as JSON (see [Note](../data-models.md#note)), `format` its version. At most one note per transcript. A note has its own `id` and `transcription_id` may be `NULL`, so a note can exist before its transcript does; today every note has a transcript. An empty note has no row.

---

## Methods

### `save(transcript) → int`

Inserts a row into `transcriptions`, all segments into `segments` (an `unassigned` segment is stored with `speaker_id = NULL`) and `transcript.match_scores` into `speaker_matches`. Sets `transcript.db_id`. Returns the new `id`.

```python
db_id = TranscriptStorageService().save(transcript)
```

**`speaker_id` logic per segment:**
```python
seg.speaker_final or seg.speaker_resolved
```

---

### `load(db_id, with_embeddings=True) → Transcript`

Loads a `Transcript` from the database by ID. Segments are ordered by ascending `start`.

`with_embeddings=False` does not read the embedding BLOBs (`segment.embedding` is `None`). API endpoints use it, since they need only text, timing and speaker IDs; `CommitService` reads embeddings with `get_embeddings_grouped_by_transcript()`.

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
    "opened":   False,             # True once the user has opened it
    "has_note": False,             # True when the recording has a note
    "duration": "12 min",          # or "1h 5m"
    "speakers": ["spk_abc", "spk_def"]
}
```

---

### `set_segments_speaker(db_id, ranges, speaker_id)`

Gives the segments identified by their `(start, end)` ranges one speaker, in one transaction, and clears their `unassigned` flag. With `speaker_id = UNASSIGNED` (`app.models.segment`) it sets the flag and stores no id. Feeds `POST /transcripts/{id}/speaker-assignments` and its undo.

```python
TranscriptStorageService().set_segments_speaker(42, [(12.4, 17.8), (17.8, 20.1)], "spk_new")
```

---

### `update_title(db_id, title) → bool`

Sets `transcriptions.title`. Returns `False` if no transcript has that id. Feeds `PATCH /transcripts/{id}`.

---

### `mark_opened(db_id) → bool`

Sets `transcriptions.opened`. Returns `False` if no transcript has that id. Feeds `POST /transcripts/{id}/opened`; `load()` never sets it.

---

### `mark_unopened(db_id) → bool`

Clears `transcriptions.opened`, so the transcript is listed as new again. Returns `False` if no transcript has that id. Feeds `DELETE /transcripts/{id}/opened`.

---

### `speaker_matches(db_id) → dict[str, dict]`

`{speaker_id: {"score": float, "confirmed": bool}}` of the transcript's `speaker_matches` rows. Feeds the possible matches of `GET /transcripts/{id}/speaker-candidates`.

---

### `matches_of_speaker(speaker_id) → dict[int, dict]`

`{transcription_id: {"score": float, "confirmed": bool}}` of the speaker's `speaker_matches` rows in every transcript. `CommitService` leaves the unconfirmed possible matches among them out of the speaker's profile.

---

### `set_match_confirmed(db_id, speaker_id, confirmed) → bool`

Sets or clears `speaker_matches.confirmed`. Returns `False` if the speaker has no row in that transcript. Called by `CommitService.confirm_match()` for `POST` and `DELETE /transcripts/{id}/possible-matches/{speaker_id}/confirmed`.

---

### `update_segment_text(db_id, start, end, new_text)`

Updates the text for a single segment identified by its time range.

---

### `delete_segment(db_id, start, end)`

Deletes a single segment identified by its time range.

---

### `get_note(db_id) → dict | None`

The note of a transcript as `{"content": dict, "updated_at": str}`, or `None` when it has none.

---

### `save_note(db_id, content) → bool`

Stores the editor's document as the transcript's note, replacing the one it had (`updated_at` changes, `created_at` stays). Returns `False` if the transcript does not exist.

---

### `delete_note(db_id)`

Deletes the transcript's note, if it has one.

---

### `delete(db_id)`

Deletes a transcription, all its segments, its `speaker_matches` rows and its note.

---

### `count_by_audio_file(audio_file) → int`

Number of transcriptions whose `audio_file` equals the given path. `DELETE /transcripts/{id}` uses it to delete a live recording only once no transcript references it.

---

### `clear() → int`

Deletes every transcription, segment, `speaker_matches` row and note in one transaction and returns the number of transcriptions removed. Schema tables are kept. Used only by `POST /data/reset`.

---

### `unassign_speaker(speaker_id) → dict`

Detaches every segment of a deleted speaker: `speaker_id = NULL`, `unassigned = 1`, and deletes their `speaker_matches` rows. Returns `{"segments": n, "transcripts": m}`. Called by `CommitService.delete_speaker()`.

---

### `move_speaker(from_id, to_id) → dict`

Gives every segment of `from_id` to `to_id`, in every transcript, and its `speaker_matches` rows with them. Where both speakers were matched in one transcript, one row stays: the higher score, confirmed if either was. One transaction. Returns the moved `{"segments": n, "transcripts": m}`. Called by `CommitService.merge_speaker()`.

---

### `speaker_stats() → dict[str, dict]`

`{speaker_id: {segments, transcripts, duration_sec, last_seen}}` over all transcripts in one query; unassigned segments are not counted. Feeds `GET /speakers`.

---

### `transcripts_for_speaker(speaker_id) → list[dict]`

Transcripts in which the speaker has segments, newest first: `id`, `title`, `created_at`, `segments`, `duration_sec`. Feeds `GET /speakers/{id}/transcripts`.

---

### `speaker_segments(speaker_id, transcript_id=None) → list[dict]`

The speaker's segments with their transcript's `audio_file` and `embedding`, optionally within one transcript — the candidates `pick_voice_sample()` chooses from for `GET /speakers/{id}/sample` and `GET /transcripts/{id}/speaker-candidates`.

---

### `get_embeddings_grouped_by_transcript(spk_id, with_durations=False, transcript_id=None) → dict[int, list]`

Returns the embeddings of the diarization turns a speaker owns, grouped by transcription id, optionally within one transcript; with `with_durations` as `(embedding, turn duration)` pairs. The sentences of a transcript with the same embedding are one turn. A turn is owned by whoever holds more than half of its sentences' duration (unassigned sentences hold their share, a tie is owned by nobody) and appears once, with the duration of all its sentences. Used by `CommitService._avg_from_db()` to recompute speaker embeddings from scratch with equal weight per recording, and for a speaker's voice in `GET /transcripts/{id}/speaker-candidates`.

---

### `_init_db()`

Creates tables if they do not exist and runs the versioned migrations in `app/db/schema.py` (tracked in `_ts_schema_version`): v1 base tables + `status`, v2 `segments.embedding`, v3 `transcriptions.title`, v4 indexes, v5 `segments.unassigned`, v6 UUIDs for stored raw diarization labels (`UNKNOWN` rows become unassigned), v7 `transcriptions.opened`, set on every transcript that existed before it so that a library does not show as new all at once, v8 `speaker_matches`, empty for transcripts that existed before it.

---

## Position in the pipeline

```
queue worker (transcription_job.run_job)
    ↓
TranscriptStorageService.save(transcript)           ← write after pipeline

GET /transcripts (router)
    ↓
TranscriptStorageService.list_all()                 ← read for sidebar

GET /transcripts/{id} (router)
    ↓
TranscriptStorageService.load(db_id)                ← read when opening a recording

POST /transcripts/{id}/speaker-assignments (router)
    ↓
TranscriptStorageService.set_segments_speaker()     ← assign a speaker
```
