---
sidebar_position: 3
---

# Data Models

Two dataclasses — `Transcript` and `Segment` — are the central data structures of the system. They are created in `TranscriptBuilder`, passed through the entire pipeline, and read during commit and save.

---

## Transcript

```python
@dataclass
class Transcript:
    segments: List[Segment] = field(default_factory=list)
    audio_path: str = ""
    language: str = ""
    status: str = "draft"
    title: str | None = None
    match_scores: dict[str, float] = field(default_factory=dict)
    db_id: int | None = None  # set by TranscriptStorageService.save()
```

| Field | Type | Description |
|---|---|---|
| `segments` | `List[Segment]` | Ordered list of transcript segments |
| `audio_path` | `str` | Path to the source audio file |
| `language` | `str` | Language detected by WhisperX (e.g. `"en"`) |
| `status` | `str` | Object status (`"draft"` by default) |
| `title` | `str \| None` | Title given by the user or the queue job |
| `match_scores` | `dict[str, float]` | `{speaker id: similarity}` of the speakers `resolve_with_scores()` recognized from memory; saved to `speaker_matches` for possible matches |
| `db_id` | `int \| None` | Database row ID, set after `save()` |

---

## Segment

```python
@dataclass
class Segment:
    start: float
    end: float
    text: str
    speaker_raw: str
    speaker_resolved: Optional[str] = None
    speaker_final: Optional[str] = None
    embedding: Any = field(default=None, compare=False, repr=False)
```

| Field | Type | Description |
|---|---|---|
| `start` | `float` | Segment start, seconds |
| `end` | `float` | Segment end, seconds |
| `text` | `str` | Segment text from Whisper: a sentence, or the part of a sentence one speaker said (see [TranscriptBuilder](services/TranscriptBuilder.md#splitting-at-a-speaker-change)) |
| `speaker_raw` | `str` | Raw diarization ID (`SPEAKER_00`, …) |
| `speaker_resolved` | `str \| None` | ID after matching against memory (UUID4) |
| `speaker_final` | `str \| None` | ID after user correction |
| `embedding` | `np.ndarray \| None` | Per-segment speaker embedding (WeSpeaker ResNet34-LM, 256 values) |

### Transcript without diarization

`Transcript.diarized` (`transcriptions.diarized`, `1` for every transcript from before the flag) is `false` when the job did not look for speakers. Its segments are stored unassigned, with no speaker and no embedding, so it never reaches speaker memory. The flag is what tells it from a recording whose speakers were all deleted.

### Speaker ID priority

Three fields form a hierarchy — the first non-null value always wins:

```
speaker_final  →  speaker_resolved  →  speaker_raw
```

This priority is applied everywhere: in `CommitService`, `TranscriptStorageService`, the Electron editor, and the controller.

### `embedding` field

Populated by `TranscriptBuilder.attach_embeddings()` via overlap-based matching with diarization results: every sentence of a diarization turn carries the turn's embedding, so the sentences of a transcript with the same embedding are one turn. Used by `CommitService` to update speaker embeddings in memory, where a turn feeds only the speaker who holds most of it (see [Invariants](system/invariants.md) → I4).

May be `None` for very short segments that had no overlapping diarization span, and for segments saved before the embedding model changed: those embeddings are dropped when the database is opened (see [EmbeddingService](services/EmbeddingService.md) → Changing the model).

---

## Speaker

A speaker is not a dataclass: it is a UUID4 with rows in the speaker memory tables (see [SpeakerMemoryService](services/SpeakerMemoryService.md)), read through `SpeakerMemoryService` and listed by `GET /speakers`.

| Data | Where | Who has it |
|---|---|---|
| Voice profile | `speaker_embeddings` | written only by `CommitService` |
| Display name | `speaker_names` | named (recognized) speakers |
| Palette colour | `speaker_meta.color_index` | every speaker |
| Handle | `speaker_meta.handle`, `handle_manual` | named speakers |
| Photo | `speaker_meta.photo`, the file in `$SONORUS_DATA_DIR/speaker_photos/` | named speakers, optional |

---

## Note

The note of a recording (meeting minutes), one per transcript at most, stored in the `notes` table (see [TranscriptStorageService](services/TranscriptStorageService.md)) apart from the segments and read and written through `GET`/`PUT`/`DELETE /transcripts/{id}/note`. An empty note is not stored. It is deleted with its recording.

Each write gives the note a new `version`, from one counter for all notes, and keeps its `writer`: `editor`, `mcp` or `api`, with a `name` where known. A writer that sends the version it started from is refused with `409` when the note has changed since, and every write and delete is announced as `note_changed` over `WS /ws/events`: that is how the editor follows a note an agent wrote ([Notes → Changes from elsewhere](ui/electron/notes.md#changes-from-elsewhere)).

`content` is the editor's document, Tiptap (ProseMirror) JSON, kept as the UI sends it:

```json
{ "type": "doc", "content": [
  { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Decisions" }] },
  { "type": "taskList", "content": [{ "type": "taskItem", "attrs": { "checked": false }, "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "Send the draft", "marks": [{ "type": "bold" }] }] }
  ]}]}
]}
```

Blocks: `paragraph`, `heading` (levels 1–3), `bulletList`, `orderedList`, `taskList` with `listItem`/`taskItem`, `blockquote`, `hardBreak`; marks `bold`, `italic`, `link` (`href`). The editor's schema also has two inline nodes that point into the app rather than holding text: `timecode` (`seconds`) and `mention` (`kind` `speaker` with the speaker's `id` and the `label` last seen, or `person` with a `label` only), so a speaker is referred to by id and never by name. Markdown is derived from the document, never stored: the document keeps what Markdown cannot, such as the id behind a mention. Copy notes writes it for people; [Note Markdown](services/NoteMarkdown.md) writes it for tools and reads it back into a document, without loss. A speaker merged into another or deleted leaves no mention behind that points at no one: `TranscriptStorageService.rewrite_note_mentions()` gives the mentions to the speaker merged into, or turns each into a `text` node with the name the speaker had (the `label` if they had none) and the marks the mention had. It writes only the notes that mention the speaker and leaves their `updated_at` and `version` alone: an editor open on such a note rewrites its own mentions the same way.

`format` (`1`) is the version of this document shape, for a migration if the editor's nodes change.

---

## Search index

What `GET /search` searches: the text of every segment, the title a recording shows and every block of a note (a paragraph, heading or list item, with a speaker mention as the speaker's name now and a timecode as `[12:34]`), in three SQLite FTS5 tables with Ё written as Е. They are derived from the tables above and never edited on their own: triggers on `segments` and `TranscriptStorageService`'s writes keep them in step ([Search index](services/TranscriptStorageService.md#search-index), invariant [I7](system/invariants.md#i7--the-search-index-matches-the-data)).

---

## Backend settings

Settings the backend needs itself, such as the switch of the [MCP server](api/mcp.md) and whether jobs use the GPU, are rows of `app_settings` (`key`, `value`), kept by [AppSettings](services/AppSettings.md). Delete all data clears them.

---

## Database schema

Everything above lives in one SQLite file, `$SONORUS_DATA_DIR/speaker_memory.db`: transcripts, segments, notes, the search index, speaker memory, the transcription queue and the backend's settings. One chain of numbered steps in `app/db/migrations.py` makes and changes every table of it; no service creates or alters a table.

- **Version.** `PRAGMA user_version` is the number of the last step applied (`migrations.LATEST`). `ensure_schema(db_path)` applies the missing steps in order. The API calls it first of all at start-up (`open_database()` in `app/api/main.py`), and every service that opens the database calls it too, so a job's process or a test never works on a database at another version.
- **One step, one transaction.** Each step runs in a transaction of its own (`BEGIN IMMEDIATE`) together with the new version number. A step cut short (a crash, a full disk) is rolled back whole, CREATE and ALTER TABLE included, and runs again at the next start. A second process opening the database meanwhile waits and then finds the step done.
- **Adding a step.** A function of the connection under the next number in `STEPS`, and `LATEST` raised to it. A released step is never edited. `tests/test_db_migrations.py` brings the database of every release up and compares it with a new one; a release that changes the schema adds its snapshot to `tests/fixtures/db/` (`tests/fixtures/db/make_snapshots.py`).
- **Step 1.** A new database gets the whole schema at once. A database of 0.2.0 to 0.3.2 had two counters of its own instead, `_ts_schema_version` (transcript tables, 6 to 12) and `_meta.schema_version` (speaker tables, 3 to 5), and the queue and settings tables had none. Step 1 takes what those releases had not done yet, then drops both counters. Before it changes such a database it copies it to `speaker_memory.db.before-migration` next to it (the SQLite backup API, so the write-ahead log is in the copy). The copy is made once and never overwritten or removed by the app; Delete all data leaves it too. If the copy cannot be made, nothing is changed and the backend does not start.
- **Refused databases.** The backend does not start on a database it cannot bring up, and leaves the file as it was: one of a newer version of Sonorus (`user_version` above `LATEST`), or one older than 0.2.0 or with counters that do not fit together. It writes `SONORUS_DB_REFUSED newer` or `SONORUS_DB_REFUSED unsupported` to stderr, and the app says why in its start-up dialog instead of a generic backend error ([Electron](ui/electron/overview.md)).

`_meta` keeps values that are not the schema: `embedding_model` (the model that computed the voices; another one resets them, see [SpeakerMemoryService](services/SpeakerMemoryService.md)) and `handle_format`.

---

## Object lifecycle

```
TranscriptBuilder.build()
    → Transcript created, speaker_resolved populated, speaker_final = None

TranscriptBuilder.attach_embeddings()
    → segment.embedding populated where possible

user review (Electron editor)
    → user sets speaker_final on corrected segments

CommitService.commit()
    → reads speaker_final / speaker_resolved and segment.embedding

TranscriptStorageService.save()
    → reads all segment fields, writes to the database
```
