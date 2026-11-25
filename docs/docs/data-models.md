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

`Transcript.diarized` (`transcriptions.diarized`, schema v10, `1` for every older transcript) is `false` when the job did not look for speakers. Its segments are stored unassigned, with no speaker and no embedding, so it never reaches speaker memory. The flag is what tells it from a recording whose speakers were all deleted.

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

A speaker is not a dataclass: it is a UUID4 with rows in the speaker memory tables (schema v5, see [SpeakerMemoryService](services/SpeakerMemoryService.md)), read through `SpeakerMemoryService` and listed by `GET /speakers`.

| Data | Where | Who has it |
|---|---|---|
| Voice profile | `speaker_embeddings` | written only by `CommitService` |
| Display name | `speaker_names` | named (recognized) speakers |
| Palette colour | `speaker_meta.color_index` | every speaker |
| Handle | `speaker_meta.handle`, `handle_manual` | named speakers |
| Photo | `speaker_meta.photo`, the file in `$SONORUS_DATA_DIR/speaker_photos/` | named speakers, optional |

---

## Note

The note of a recording (meeting minutes), one per transcript at most, stored in the `notes` table (schema v9, see [TranscriptStorageService](services/TranscriptStorageService.md)) apart from the segments and read and written through `GET`/`PUT`/`DELETE /transcripts/{id}/note`. An empty note is not stored. It is deleted with its recording.

Each write gives the note a new `version` (schema v12), from one counter for all notes, and keeps its `writer`: `editor`, `mcp` or `api`, with a `name` where known. A writer that sends the version it started from is refused with `409` when the note has changed since, and every write and delete is announced as `note_changed` over `WS /ws/events`: that is how the editor follows a note an agent wrote ([Notes → Changes from elsewhere](ui/electron/notes.md#changes-from-elsewhere)).

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

What `GET /search` searches: the text of every segment, the title a recording shows and every block of a note (a paragraph, heading or list item, with a speaker mention as the speaker's name now and a timecode as `[12:34]`), in three SQLite FTS5 tables (schema v11) with Ё written as Е. They are derived from the tables above and never edited on their own: triggers on `segments` and `TranscriptStorageService`'s writes keep them in step ([Search index](services/TranscriptStorageService.md#search-index), invariant [I7](system/invariants.md#i7--the-search-index-matches-the-data)).

---

## Backend settings

Settings the backend needs itself, such as the switch of the [MCP server](api/mcp.md), are rows of `app_settings` (`key`, `value`), kept by [AppSettings](services/AppSettings.md) outside the versioned schema. Delete all data clears them.

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
