---
sidebar_position: 4
---

# Transcript Builder

`TranscriptBuilder` is a static converter service. Transforms raw ML pipeline output into the domain model (`Transcript` / `Segment`).

Does not perform inference, does not persist data, makes no business decisions — only maps data structures.

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
    speaker_resolved=speaker_map.get(raw_speaker),  # None if not in mapping
    speaker_final=None                              # set only by the user
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

**Algorithm:** for each transcript segment, finds the diarization span with maximum time overlap:

```python
overlap = max(0.0, min(seg.end, emb["end"]) - max(seg.start, emb["start"]))
```

A segment receives the embedding of the span with the highest overlap. If no overlap exists with any span, `segment.embedding` stays `None`.

**Why overlap instead of nearest distance:**

WhisperX produces fine-grained segments; diarization produces coarser spans. A "nearest by time" approach produced incorrect matches at different granularities. Overlap works correctly in both directions: when multiple transcript segments fall within one diarization span, and vice versa.

---

## When `speaker_resolved` is `None`

If `raw_speaker` was not present in `speaker_map` (e.g. the speaker was filtered out during embedding extraction), `speaker_resolved` stays `None`. In the CLI and in `commit()`, `speaker_raw` is used as a fallback in such segments.
