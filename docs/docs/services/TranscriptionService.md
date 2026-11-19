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
Whisper detects the language (unless the job names one) and splits speech into segments with text.

**Language detection.** WhisperX on its own detects the language from the first 30 s of the file, silence, ring tones and music included, and takes the most likely language however unsure. A live recording usually starts with silence, and a wrong language puts the whole transcript into another language or fails the job on an alignment model it does not need. So `__init__` hooks `app/services/language_detection.py` into the pipeline (`install()`): the VAD model's `merge_chunks()` is wrapped to keep what it returns, and the pipeline's `detect_language()`, which `transcribe()` calls right after it when no language was given, is replaced. The language then comes from the speech of the same VAD pass, with no second VAD run:

- the first 30 s of speech (`LANGUAGE_WINDOW_S`), the intervals glued together and padded to Whisper's 30 s window; Whisper's encoder gives the probability of every language;
- if the most likely language is below `LANGUAGE_CONFIDENT` (0.8), up to two more windows (`LANGUAGE_MAX_WINDOWS` = 3 in all): 30 s around the middle of the speech and 30 s at its end, never overlapping a window already taken; the probabilities are averaged over the windows, weighted by their seconds of speech, and the most likely language wins;
- if VAD found no speech, WhisperX's own detection runs as before.

The log names the language, its probability, how much speech in how many windows and where in the recording it was, e.g. `Language: ru (0.97) from 30 s of speech in 1 window, speech 0:42–3:10`. How the old and the new way compare on recordings with silence, noise, a ring tone or music before the speech: [Quality tests → Language detection](../testing/quality.md#language-detection).

**3. Alignment**
```python
align_model, metadata = whisperx.load_align_model(
    language_code=..., device=..., model_name=ALIGNMENT_CATALOG[language]["hf_repo"],
    model_dir=..., model_cache_only=True)
result = whisperx.align(result["segments"], align_model, metadata, audio, device)
```
Refines timestamps to word level. The alignment model depends on the language detected in step 2: the catalog's repo for it, read from `.models/alignment` only. A catalog language whose model is not installed raises `AlignmentModelMissingError` before anything loads. WhisperX's own default is never used for a catalog language: for English, French, German, Spanish and Italian it is a torchaudio bundle that `torch.hub` would download from `download.pytorch.org` in the middle of the job (the pipeline child refuses those downloads). The catalog's repos for these five are the same checkpoints: the same emissions on the same audio, except Spanish, where the torchaudio bundle's labels for `k`, `w` and `ü` are one row off its weights and the Hub repo's are not.

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
