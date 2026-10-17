---
sidebar_position: 2
---

# Quality Tests

The unit tests never load a model. The quality tests do: they run the real pipeline (WhisperX `large-v3`, alignment, PyAnnote diarization and embeddings, speaker memory) on a fixed set of English meeting recordings and score the transcripts against a human reference. They answer two questions:

- what each way the audio reaches the models does to the transcript (codec, Chromium's microphone processing, loudness levelling, the VAD threshold);
- whether named speakers are recognised in the next recordings of the same people.

They run only on request, on a machine with the models; CI and a plain `pytest tests/` skip them.

## Test set

Three 3-minute clips of the [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/) (meetings ES2002b, ES2002c and ES2002d, the same four participants), released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by the AMI project. Clips, devices and checksums are fixed in `tests/quality/ami_manifest.json`.

`scripts/eval/build_ami_set.py` downloads only the clip windows of each participant's headset track (HTTP range requests, about 70 MB) and the manual annotations (23 MB), checks them against the sha256 values in the manifest and writes, per clip, into `$SONORUS_EVAL_CACHE/ami` (default `~/.cache/sonorus-eval/ami`):

| File | Content |
|---|---|
| `ref.json` | Reference words with start, end and speaker (AMI global speaker id, e.g. `FEE005`), from the manual word annotations |
| `tracks/<speaker>.wav` | One participant's headset, 16 kHz mono. The headsets also pick up the others in the room, so a track keeps only its owner's annotated speech (0.25 s around each word, 20 ms fades); the headsets are not calibrated either, so every track is brought to −30 dBFS speech level |
| `clean.wav` | Sum of the tracks |
| `call.wav` | Every participant through their own device, then summed: laptop microphone (200 Hz – 7 kHz, −8 dB, pink noise), Bluetooth headset (300 Hz – 3.4 kHz, Opus 16 kbit/s), a quiet participant (−18 dB), a plain microphone. A person keeps the same device in every clip |
| `uneven.wav` | `clean.wav` with one participant 20 dB down |
| `chromium-default.webm` | `call.wav` recorded the way the app records the microphone (with `--chromium`, see below) |
| `chromium-raw.webm` | The same with echo cancellation, noise suppression and auto gain control off |

The build is deterministic (`-bitexact` ffmpeg output, fixed noise seed): two builds with the same ffmpeg produce identical files. The Chromium recordings are real-time captures and differ slightly from run to run.

`scripts/eval/chromium_capture.js` plays a WAV file to Chromium as a fake capture device (`--use-file-for-fake-audio-capture`) and records it with the graph of `startRecording()` in `electron/renderer/app.js`: `getUserMedia` → `AudioContext` → `MediaStreamDestination` → `MediaRecorder` (`audio/webm;codecs=opus`). Chromium applies its microphone processing to the fake device as to a real one. Each recording takes as long as the clip.

## Running

```bash
# Once: the set (2 minutes), plus the Chromium recordings (about 20 minutes, needs npm ci)
.venv/bin/python scripts/eval/build_ami_set.py --chromium

# The quality tests (about 10 minutes on an 8 GB GPU)
SONORUS_QUALITY=1 .venv/bin/python -m pytest tests/quality -v -s
```

| Variable | Default | Purpose |
|---|---|---|
| `SONORUS_QUALITY` | — | `1` runs the quality tests; otherwise they are skipped |
| `SONORUS_MODELS_DIR` | `~/.config/sonorus-dev/.models` | Models of the dev app; must hold `large-v3`, the diarization and the embedding model |
| `SONORUS_EVAL_CACHE` | `~/.cache/sonorus-eval` | Where the set and the reports are written |

The tests also skip when the ML libraries are the CI stubs or the set is not built. Speaker memory and transcripts go to a temporary database; the models are resolved from the local cache in offline mode (as in the pipeline child), so nothing is downloaded except the English alignment model on the first run.

## What is measured

Each **variant** is one way the audio reaches the models (`VARIANTS` in `tests/quality/harness.py`). Its three clips run through `TranscriptionController.run_pipeline()` on a fresh speaker memory, in order:

1. the first clip's diarised speakers are mapped to the reference speakers and named after them, the way the editor does it (`reassign_speaker` to a new speaker by name);
2. the next clips are transcribed with that memory; after each the transcript is saved and `commit_recognized_speakers()` runs, as the queue does after a job.

Metrics (`tests/quality/metrics.py`, unit-tested in `tests/test_quality_metrics.py`):

| Metric | Meaning |
|---|---|
| WER | Word error rate against the reference after normalisation: lowercase, no punctuation, hyphens split words, digits spelled out, hesitations (`um`, `uh`, `mm`, …) removed on both sides |
| Speaker words | Share of aligned words (equal or substituted) whose transcript speaker maps to the reference speaker. Transcript speakers are mapped one-to-one to reference speakers by overlapping time |
| Missed utterances | Reference utterances (one speaker, no pause over 1 s) of which less than half of the words were recognised, with the level of the audio there. Utterances of 3+ words and shorter ones (mostly backchannels such as "yeah" over someone else's speech) are counted apart |
| Words per speaker | Share of each reference speaker's words found in the transcript — shows whether the quiet participant or one device loses more |
| Recognised | In the second and third clip: transcript speakers matched by the memory to the right named speaker / all named speakers present |
| Similarity (own / other) | Cosine similarity between a speaker's mean segment embedding in a later clip and their own profile from the first clip, and the highest one to another person's profile — `resolve()` compares this kind of value with `SPEAKER_SIMILARITY_THRESHOLD` |

A variant with a **base** is processing applied to that base (for example `chromium-default` against `chromium-raw`); its test fails if it is worse than the base by more than 2 points of WER, 5 points of speaker words or 0.03 of own similarity. The recognised count is reported but not checked: while similarities sit near the threshold it moves by two between nearly equal inputs. Variants without a base (`clean`, `call`, `uneven`) are listening conditions and only report. Recognition does not depend on the run order: every variant starts from an empty memory.

`tests/quality/test_mix_tail.py` checks the mix of microphone and system audio (`AudioCaptureService._merge`) on synthetic tones, without models. Its tests are marked `xfail(strict=True)` while the mix is known to drop or shift audio; a fix makes them pass and pytest then reports them, so the marker gets removed.

## Report

At the end, pytest prints a Markdown report and saves it as `$SONORUS_EVAL_CACHE/reports/<date-time>.md`: a summary per variant, every clip (WER split into substitutions / deletions / insertions, speakers found, detected language, time), and the text of each missed utterance with its level. Numbers depend on the versions of the models and libraries, so variants are compared within one run, never with numbers from another one.
