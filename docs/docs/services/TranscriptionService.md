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
    → diarization  → EmbeddingService.extract_all()
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
diarization = diarize_model(audio)
```
PyAnnote splits the audio into spans and assigns each to a speaker (`SPEAKER_00`, `SPEAKER_01`, …).

**5. Speaker assignment**
```python
result = whisperx.assign_word_speakers(diarization, result)
```
Each segment and word in `result` receives a `speaker` label from the diarization output.

---

## Output

| Variable | Type | Used by |
|---|---|---|
| `result` | `dict` with `result["segments"]`, `result["language"]` | `TranscriptBuilder.build()` |
| `audio` | `np.array` (mono, 16 kHz) | `EmbeddingService.extract_all()` |
| `diarization` | `DataFrame`: `start`, `end`, `speaker` | `EmbeddingService.extract_all()` |

---

## Requirements

- HuggingFace token in `.env` (`HF_TOKEN`) — required for downloading PyAnnote diarization models
- Audio file in WAV format, mono, 16 kHz (conversion: `converter.py`)
