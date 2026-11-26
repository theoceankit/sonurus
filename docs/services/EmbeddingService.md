---
sidebar_position: 1
---

# Embedding Service

`EmbeddingService` extracts speaker embeddings from audio using diarization output.

The model is WeSpeaker ResNet34-LM (256 values per embedding) — the embedding model of the diarization pipeline itself, read from the `embedding` subfolder of `pyannote/speaker-diarization-community-1`, which the diarization download already brings. No other repo is needed and nothing is fetched at run time (`config.EMBEDDING_REPO`, `EMBEDDING_SUBFOLDER`).

Converts speech segments into voice vector representations (`np.array`) used for:
- matching speakers within a session
- comparing voices across sessions
- attaching per-segment embeddings to transcript segments

---

## Architecture

The service provides two embedding representations:

| Representation | Method | Used by |
|---|---|---|
| Aggregated (per `SPEAKER_XX`) | `extract_all()` | `SpeakerMemoryService.resolve()` |
| Per-segment (per diarization span) | `extract_all()` | `TranscriptBuilder.attach_embeddings()` |

`extract_all()` is the only public method — a single pass of the model returns both representations. A diarization speaker whose spans are all shorter than `min_duration` gets no aggregated embedding; `TranscriptBuilder` then gives it a new UUID without a voice profile.

---

## Data format

**Input**
```
audio            — np.array, full audio waveform
diarize_segments — DataFrame: start | end | speaker
```

`TranscriptionService` passes the **exclusive** diarization: one speaker at a time, with overlapped speech given to one of the speakers. A span then holds one voice instead of two people talking over each other, which keeps another person's voice out of the speaker's embedding.

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

### `__init__(device, sample_rate=EMBEDDING_SAMPLE_RATE, min_duration=EMBEDDING_MIN_DURATION, models_dir=MODELS_DIR)`

Initialises the service and loads WeSpeaker ResNet34-LM with `Model.from_pretrained(EMBEDDING_REPO, subfolder="embedding", cache_dir=models_dir / "hf")`, wrapped in `Inference(window="whole")`: one embedding per audio slice. A model that cannot be loaded raises `RuntimeError`.

**Parameters:**
- `device` — torch device (`cuda` / `cpu`)
- `sample_rate` — audio sample rate (typically 16000)
- `min_duration` — minimum segment length in seconds; shorter segments are skipped

---

### `extract_all(audio, diarize_segments)`

Primary method. Single pass of the model — returns both representations.

```python
aggregated, segments = embedding_service.extract_all(audio, diarization)
```

**Returns:** `(aggregated_dict, segments_list)`

Delegates internally to `_extract_segments()` + `_aggregate_from_segments()`.

---

### `_extract_segments(audio, diarize_segments)`

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

Low-level method. Slices the audio chunk, converts to `torch.Tensor` of shape `(1, time)`, and passes it to the model's `pyannote.audio.Inference`.

Returns `None` if `len(chunk) < sample_rate` — the model requires at least ~1 second of data (shorter input can cause `max_pool1d()` errors).

---

### `_aggregate(speaker_embeddings, speaker_durations)`

Static method. Turns per-speaker embedding lists into one voice each with `voice_vector()` (`app/services/voice_vector.py`): every turn's embedding scaled to length 1, weighted by the turn's duration, averaged and scaled to length 1.

```python
final_embeddings[speaker] = voice_vector(embs, durations)
```

Averaging is necessary because a speaker appears in multiple segments, each producing a slightly different vector. Embedding lengths vary several-fold between turns, and a 1-second turn is a much noisier picture of a voice than a minute, so neither may weigh as much as the plain mean gives it. Profiles are averaged the same way (see [CommitService](CommitService.md)).

---

## `min_duration` parameter

Recommended values:
- `0.5` — more data, but noisier embeddings
- `1.0` — balanced (default)
- `2.0` — only high-confidence segments

---

## Changing the model

Embeddings of different models cannot be compared (they do not even have the same length: the previous model, `pyannote/embedding`, gave 512 values). The database therefore records which model computed its voices, as `_meta.embedding_model` = `config.EMBEDDING_MODEL_ID`. When `SpeakerMemoryService` opens a database without that mark or with another model in it, it drops every segment embedding and every voice profile and writes the mark; names, handles, colours and the speaker of every segment stay (see [SpeakerMemoryService](SpeakerMemoryService.md) → `_init_db`). Recognition then starts over from new recordings. A new model needs a new `EMBEDDING_MODEL_ID`.

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
