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
| `text` | `str` | Segment text from Whisper |
| `speaker_raw` | `str` | Raw diarization ID (`SPEAKER_00`, …) |
| `speaker_resolved` | `str \| None` | ID after matching against memory (UUID4) |
| `speaker_final` | `str \| None` | ID after user correction |
| `embedding` | `np.ndarray \| None` | Per-segment speaker embedding (WeSpeaker ResNet34-LM, 256 values) |

### Speaker ID priority

Three fields form a hierarchy — the first non-null value always wins:

```
speaker_final  →  speaker_resolved  →  speaker_raw
```

This priority is applied everywhere: in `CommitService`, `TranscriptStorageService`, the Electron editor, and the controller.

### `embedding` field

Populated by `TranscriptBuilder.attach_embeddings()` via overlap-based matching with diarization results. Used only by `CommitService.commit()` to update speaker embeddings in memory.

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
