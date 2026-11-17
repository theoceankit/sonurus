---
sidebar_position: 5
---

# Transcription Service

`TranscriptionService` is the first step of the pipeline. It performs the full audio processing cycle: transcription, word-level alignment, and speaker diarization.

Produces three objects that flow into different parts of the system.

---

## Position in the pipeline

```
audio_path
    ↓
TranscriptionService.transcribe()
    → result       → TranscriptBuilder.build()
    → audio        → EmbeddingService.extract_all()
    → diarization  → EmbeddingService.extract_all()   (exclusive diarization)
```

---

## Methods

### `__init__(device)`

Loads the WhisperX `large` model at initialisation time.

**Parameter:**
- `device` — `"cuda"` or `"cpu"`

**Compute type** is selected automatically:
- CUDA → `int8_float16` (faster, less VRAM)
- CPU → `int8`

The model is loaded once at object construction — not on every `transcribe()` call.

---

### `transcribe(audio_path) → (result, audio, diarization)`

Runs five sequential steps:

**1. Audio loading**
```python
audio = whisperx.load_audio(audio_path)
```
Returns `np.array` (mono, 16 kHz).

**2. Transcription (ASR)**
```python
result = self.model.transcribe(audio, batch_size=4)
```
Whisper detects the language and splits speech into segments with text.

**3. Alignment**
```python
align_model, metadata = whisperx.load_align_model(language_code=..., device=...)
result = whisperx.align(result["segments"], align_model, metadata, audio, device)
```
Refines timestamps to word level. The alignment model depends on the language detected in step 2.

After loading the align model, `torch.cuda.empty_cache()` is called to free VRAM before the next inference step.

**4. Diarization**
```python
diarize_model = whisperx.diarize.DiarizationPipeline(device=device)
regular, exclusive = diarize(diarize_model, audio)   # app/services/diarization.py
```
PyAnnote splits the audio into spans and assigns each to a speaker (`SPEAKER_00`, `SPEAKER_01`, …). Its pipeline returns two diarizations with the same labels, and `diarize()` keeps both (whisperx's own call returns only the first):

- **regular** — speakers may overlap: when two people talk at once, both have a span there;
- **exclusive** — one speaker at a time: overlapped speech goes to one of them.

**5. Speaker assignment**
```python
result = whisperx.assign_word_speakers(regular, result)
assign_gap_sentences(result, regular[["start", "end", "speaker"]].itertuples(index=False))
```
Each segment and each word with a time in `result` receives a `speaker` label from the regular diarization: the speaker with the most time inside it. A word without a time, or one in a gap between diarization spans, gets none. The exclusive diarization made no measurable difference here, because overlaps are short against a Whisper segment.

A segment that overlaps no span at all — a short or quiet sentence the diarization did not mark, or one of zero length — then gets the speaker of the nearest span within 1 s ([Sentences between turns](TranscriptBuilder.md#sentences-between-turns)); further away it keeps none and becomes Unassigned.

The segment's label is only used when its words have a single speaker: `TranscriptBuilder` cuts a segment whose words belong to different speakers (see [TranscriptBuilder](TranscriptBuilder.md#splitting-at-a-speaker-change)).

The exclusive diarization is returned for the voice embeddings: its spans hold one voice each, so another person's overlapped speech stays out of a speaker's embedding. On the AMI quality set it lowered the similarity to other people's profiles without changing the similarity to one's own.

---

## Output

| Variable | Type | Used by |
|---|---|---|
| `result` | `dict` with `result["segments"]`, `result["language"]` (the language Whisper detected or was given; set again after alignment and speaker assignment, which drop it) | `TranscriptBuilder.build()` |
| `audio` | `np.array` (mono, 16 kHz) | `EmbeddingService.extract_all()` |
| `diarization` | `DataFrame`: `start`, `end`, `speaker` — the exclusive diarization | `EmbeddingService.extract_all()`, then `TranscriptBuilder.attach_embeddings()` |

---

## Requirements

- HuggingFace token in `.env` (`HF_TOKEN`) — required for downloading PyAnnote diarization models
- Any audio/video file `ffmpeg` can decode — `whisperx.load_audio()` resamples it to 16 kHz mono
