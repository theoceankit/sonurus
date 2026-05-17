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
    db_id: int | None = None  # set by TranscriptStorageService.save()
```

| Field | Type | Description |
|---|---|---|
| `segments` | `List[Segment]` | Ordered list of transcript segments |
| `audio_path` | `str` | Path to the source audio file |
| `language` | `str` | Language detected by WhisperX (e.g. `"en"`) |
| `status` | `str` | Object status (`"draft"` by default) |
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
| `embedding` | `np.ndarray \| None` | Per-segment pyannote embedding |

### Speaker ID priority

Three fields form a hierarchy — the first non-null value always wins:

```
speaker_final  →  speaker_resolved  →  speaker_raw
```

This priority is applied everywhere: in `CommitService`, `TranscriptStorageService`, the CLI view, and the controller.

### `embedding` field

Populated by `TranscriptBuilder.attach_embeddings()` via overlap-based matching with diarization results. Used only by `CommitService.commit()` to update speaker embeddings in memory.

May be `None` for very short segments that had no overlapping diarization span.

---

## Object lifecycle

```
TranscriptBuilder.build()
    → Transcript created, speaker_resolved populated, speaker_final = None

TranscriptBuilder.attach_embeddings()
    → segment.embedding populated where possible

user review (CLI / Electron editor)
    → user sets speaker_final on corrected segments

CommitService.commit()
    → reads speaker_final / speaker_resolved and segment.embedding

TranscriptStorageService.save()
    → reads all segment fields, writes to the database
```
