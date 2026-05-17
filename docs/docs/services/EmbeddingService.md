---
sidebar_position: 1
---

# Embedding Service

`EmbeddingService` extracts speaker embeddings from audio using diarization output.

Converts speech segments into voice vector representations (`np.array`) used for:
- matching speakers within a session
- comparing voices across sessions
- attaching per-segment embeddings to transcript segments

---

## Architecture

The service provides two embedding representations:

| Representation | Method | Used by |
|---|---|---|
| Aggregated (per `SPEAKER_XX`) | `extract_all()`, `extract()` | `SpeakerMemoryService.resolve()` |
| Per-segment (per diarization span) | `extract_all()`, `extract_segments()` | `TranscriptBuilder.attach_embeddings()` |

**Recommended method:** `extract_all()` — single pyannote pass, returns both representations at once.

---

## Data format

**Input**
```
audio            — np.array, full audio waveform
diarize_segments — DataFrame: start | end | speaker
```

**Aggregated output**
```python
{
    "SPEAKER_00": np.array([...]),  # mean over all segments for this speaker
    "SPEAKER_01": np.array([...])
}
```

**Per-segment output**
```python
[
    {"start": 0.15, "end": 1.87, "speaker": "SPEAKER_00", "embedding": np.array([...])},
    {"start": 4.54, "end": 8.24, "speaker": "SPEAKER_01", "embedding": np.array([...])},
]
```

---

## Methods

### `__init__(device, sample_rate=16000, min_duration=1.0)`

Initialises the service and loads the `pyannote/embedding` model.

**Parameters:**
- `device` — torch device (`cuda` / `cpu`)
- `sample_rate` — audio sample rate (typically 16000)
- `min_duration` — minimum segment length in seconds; shorter segments are skipped

---

### `extract_all(audio, diarize_segments)`

Primary method. Single pyannote pass — returns both representations.

```python
aggregated, segments = embedding_service.extract_all(audio, diarization)
```

**Returns:** `(aggregated_dict, segments_list)`

Delegates internally to `extract_segments()` + `_aggregate_from_segments()`.

---

### `extract(audio, diarize_segments)`

Returns only the aggregated embeddings. Useful when per-segment is not needed.

**Returns:** `{"SPEAKER_00": np.array([...]), ...}`

---

### `extract_segments(audio, diarize_segments)`

Returns an embedding for each individual diarization segment, without aggregation.

Segments shorter than `min_duration` and those with fewer than one second of audio are skipped (embedding will be `None`).

**Returns:** `[{"start": float, "end": float, "speaker": str, "embedding": np.array}, ...]`

---

### `_aggregate_from_segments(segment_embeddings)`

Converts a per-segment list into an aggregated dict:

```python
[{"speaker": "SPEAKER_00", "embedding": ...}, ...]
→ {"SPEAKER_00": mean_embedding, ...}
```

---

### `_get_embedding(audio, start, end)`

Low-level method. Slices the audio chunk, converts to `torch.Tensor` of shape `(1, time)`, and passes it to `pyannote.Inference`.

Returns `None` if `len(chunk) < sample_rate` — the model requires at least ~1 second of data (shorter input can cause `max_pool1d()` errors).

---

### `_aggregate(speaker_embeddings)`

Static method. Mean-pools per-speaker embedding lists:

```python
final_embeddings[speaker] = np.mean(embs, axis=0)
```

Averaging is necessary because a speaker appears in multiple segments, each producing a slightly different vector.

---

## `min_duration` parameter

Recommended values:
- `0.5` — more data, but noisier embeddings
- `1.0` — balanced (default)
- `2.0` — only high-confidence segments

---

## Position in the pipeline

```
TranscriptionService.transcribe()
    → diarize_segments (DataFrame)
    ↓
EmbeddingService.extract_all()
    → aggregated  → SpeakerMemoryService.resolve()
    → segments    → TranscriptBuilder.attach_embeddings()
```
