---
sidebar_position: 4
---

# Transcript Builder

`TranscriptBuilder` is a static converter service. Transforms raw ML pipeline output into the domain model (`Transcript` / `Segment`).

Does not perform inference and does not persist data. Its one rule: raw diarization labels never become the speaker of a segment (see [Speakers without a match](#speakers-without-a-match)).

---

## Position in the pipeline

```
WhisperX result + speaker_map
    ↓
TranscriptBuilder.build()
    → Transcript (draft, embedding=None for all segments)
    ↓
TranscriptBuilder.attach_embeddings()
    → Transcript (segment.embedding populated where possible)
    ↓
user review
```

---

## Methods

### `build(result, speaker_map, audio_path) → Transcript`

Assembles a `Transcript` from the WhisperX result and the speaker mapping.

**Parameters:**
- `result` — dict from WhisperX, contains `result["segments"]` and `result["language"]`
- `speaker_map` — mapping `{"SPEAKER_00": "spk_abc", ...}` from `SpeakerMemoryService.resolve()`
- `audio_path` — path to the audio file

**For each WhisperX segment:**
```python
Segment(
    start=seg["start"],
    end=seg["end"],
    text=seg["text"].strip(),
    speaker_raw=seg.get("speaker", "UNKNOWN"),   # raw diarization ID
    speaker_resolved=<UUID>,                        # from speaker_map, or a new UUID
    speaker_final=None,                             # set only by the user
    unassigned=<no diarization speaker>,            # True for UNKNOWN
)
```

**Returns:** `Transcript` with status `"draft"`, all `embedding = None`.

---

### `attach_embeddings(transcript, segment_embeddings) → Transcript`

Assigns per-segment embeddings to transcript segments using time overlap.

**`segment_embeddings` parameter** — list from `EmbeddingService.extract_segments()`:
```python
[{"start": float, "end": float, "speaker": str, "embedding": np.ndarray}, ...]
```

**Algorithm:** for each transcript segment, considers only diarization spans of the **same speaker** (`emb["speaker"] == seg.speaker_raw`) and picks the one with maximum time overlap:

```python
overlap = max(0.0, min(seg.end, emb["end"]) - max(seg.start, emb["start"]))
```

A segment receives the embedding of the same-speaker span with the highest overlap. If no span of its speaker overlaps it, `segment.embedding` stays `None`.

**Why same speaker only:** a Whisper segment can span a speaker change. Picking the largest overlap regardless of speaker would attach another person's voice to the segment, and `CommitService` would then mix it into this speaker's stored embedding.

**Why overlap instead of nearest distance:**

WhisperX produces fine-grained segments; diarization produces coarser spans. A "nearest by time" approach produced incorrect matches at different granularities. Overlap works correctly in both directions: when multiple transcript segments fall within one diarization span, and vice versa.

---

## Speakers without a match

`resolve()` maps only diarization speakers that have an aggregated embedding (enough speech, see `EMBEDDING_MIN_DURATION`).

- A `SPEAKER_XX` missing from `speaker_map` gets a **new UUID** — one per label within the transcript. It is an unnamed speaker without a voice profile: it shows up in the Speakers section and can be named, reassigned or deleted, but is not recognized in later recordings.
- A segment without any diarization speaker (`UNKNOWN`) gets `speaker_resolved = None` and `unassigned = True` — it waits for the user to assign someone.

So `speaker_raw` is never the effective speaker of a stored segment. Transcript schema v6 applied the same rule to rows saved earlier.
