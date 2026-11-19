---
sidebar_position: 2
---

# Quality Tests

The unit tests never load a model. The quality tests do: they run the real pipeline (WhisperX `large-v3`, alignment, PyAnnote diarization and embeddings, speaker memory) on a fixed set of English meeting recordings and score the transcripts against a human reference. They answer two questions:

- what each way the audio reaches the models does to the transcript (codec, Chromium's microphone processing, loudness levelling, the VAD threshold);
- whether named speakers are recognised in the next recordings of the same people.

They run only on request, on a machine with the models; CI and a plain `pytest tests/` skip them. There are two sets: the fast one (3-minute clips, about 10 minutes, the regression check for audio processing) and the [long set](#long-set) (10-minute windows, whole meetings and other people, for the speaker recognition threshold).

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
| `chromium-default.webm` | `call.wav` recorded the way the app recorded the microphone in its window before the backend recorded it (with `--chromium`, see below) |
| `chromium-raw.webm` | The same with echo cancellation, noise suppression and auto gain control off |

The build is deterministic (`-bitexact` ffmpeg output, fixed noise seed): two builds with the same ffmpeg produce identical files. The Chromium recordings are real-time captures and differ slightly from run to run.

`scripts/eval/chromium_capture.js` plays a WAV file to Chromium as a fake capture device (`--use-file-for-fake-audio-capture`) and records it with the graph the window used for the microphone before the backend recorded it: `getUserMedia` → `AudioContext` → `MediaStreamDestination` → `MediaRecorder` (`audio/webm;codecs=opus`). Chromium applies its microphone processing to the fake device as to a real one. Each recording takes as long as the clip.

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
| `SONORUS_MODELS_DIR` | `~/.config/sonorus-dev/.models` | Models of the dev app; must hold `large-v3`, the diarization model (with the embedding model) and the English alignment model |
| `SONORUS_EVAL_CACHE` | `~/.cache/sonorus-eval` | Where the set and the reports are written |

`SONORUS_QUALITY_LONG=1` runs the [long set](#long-set) instead. The tests also skip when the ML libraries are the CI stubs or the set is not built. Speaker memory and transcripts go to a temporary database; the models are resolved from the local cache in offline mode (as in the pipeline child), so nothing is downloaded: download the English alignment model in the dev app's Settings first.

## What is measured

Each **variant** is one way the audio reaches the models (`VARIANTS` in `tests/quality/harness.py`). Its three clips run through `TranscriptionController.run_pipeline()` on a fresh speaker memory, in order:

1. the first clip's diarised speakers are mapped to the reference speakers and named after them, the way the editor does it (`assign_speaker`, the route `POST /transcripts/{id}/speaker-assignments`, with all of a speaker's segments to a new speaker by name);
2. the next clips are transcribed with that memory; after each the transcript is saved and `commit_recognized_speakers()` runs, as the queue does after a job.

Metrics (`tests/quality/metrics.py`, unit-tested in `tests/test_quality_metrics.py`):

| Metric | Meaning |
|---|---|
| WER | Word error rate against the reference after normalisation: lowercase, no punctuation, hyphens split words, digits spelled out, hesitations (`um`, `uh`, `mm`, …) removed on both sides |
| Speaker words | Share of aligned words (equal or substituted) whose transcript speaker maps to the reference speaker. Transcript speakers are mapped one-to-one to reference speakers by overlapping time |
| Missed utterances | Reference utterances (one speaker, no pause over 1 s) of which less than half of the words were recognised, with the level of the audio there. Utterances of 3+ words and shorter ones (mostly backchannels such as "yeah" over someone else's speech) are counted apart |
| Short utterances | Reference utterances of 1–2 words with at least one word recognised, and how many of them are under the right person (every recognised word under the transcript speaker mapped to them). Mostly backchannels and interjections over someone else's speech, which speaker words barely contains |
| Unassigned | Transcript segments without a speaker (`unassigned`), their number and seconds |
| Mixed segments | Transcript segments whose words, aligned with the reference as equal, belong to two or more reference speakers, out of all segments, and the words in them of anyone but the segment's main person. A segment is one speaker's in the app, so these words are under the wrong person |
| Segment shape | In what the pipeline returned before the transcript was built (`TranscriptionService.transcribe()`): segments without a timed word, with empty text and longer than 15 s |
| Words per speaker | Share of each reference speaker's words found in the transcript — shows whether the quiet participant or one device loses more |
| Recognised | In the second and third clip: transcript speakers matched by the memory to the right named speaker / all named speakers present |
| Similarity (own / other) | Cosine similarity between a speaker's mean segment embedding in a later clip and their own profile from the first clip, and the highest one to another person's profile — `resolve()` compares this kind of value with `SPEAKER_SIMILARITY_THRESHOLD` |

A variant with a **base** is processing applied to that base (for example `chromium-default` against `chromium-raw`); its test fails if it is worse than the base by more than 2 points of WER, 5 points of speaker words or 0.03 of own similarity. Short utterances, unassigned, mixed segments and segment shape are reported, not checked. The recognised count is reported but not checked: while similarities sit near the threshold it moves by two between nearly equal inputs. Variants without a base (`clean`, `call`, `uneven`) are listening conditions and only report. Recognition does not depend on the run order: every variant starts from an empty memory. When a later clip's speaker is matched to another named person, it counts as wrong.

`clean-nosplit` and `call-nosplit` only report as well: the same audio with sentences never cut at a word-speaker change ([TranscriptBuilder](../services/TranscriptBuilder.md#splitting-at-a-speaker-change)), for comparing with `clean` and `call` in one run. `call-nogap`, `chromium-default-nogap` and `uneven-nogap` only report too: a sentence between diarization turns left unassigned instead of given to the nearest turn ([Sentences between turns](../services/TranscriptBuilder.md#sentences-between-turns)), for comparing with `call`, `chromium-default` and `uneven`.

## Long set

The fast set's clips hold 20–60 s of each person's speech; real calls run 30–60 minutes and a user's memory holds more than four people. The long set measures how recognition depends on both. It runs only clean and call (the processing variants are compared by the fast set):

| Series | Clips, in order (named ones in bold) | Question |
|---|---|---|
| 3 min | **es2002b**, es2002c, es2002d | the fast set's clips, as the baseline |
| 10 min | **es2002b-10m**, es2002c-10m, es2002d-10m | 10-minute windows around the 3-minute clips |
| whole | **es2002b-full**, es2002c-full, es2002d-full | the whole meetings, 36–40 minutes each |
| 10 min, named in two | **es2002a-10m**, **es2002b-10m**, es2002c-10m, es2002d-10m | a profile built from two recordings; in the second named clip the speakers are assigned to the existing speaker of their name |
| three groups | **es2002b-10m**, **es2004b-10m**, **is1009b-10m**, then c and d of each | ES2002, ES2004 (two women, two men) and IS1009 (four women, another room) in one memory: false matches between people who never met |

A false match counts in every clip, also in a named one, where the people of earlier groups are already in memory; the test of "three groups" fails on any. The other series only report.

```bash
# Once: about 1 GB to download (whole meetings take the full headset files, ~70 MB each), about 3 GB on disk
.venv/bin/python scripts/eval/build_ami_set.py --long

# About 30 minutes on an 8 GB GPU
SONORUS_QUALITY_LONG=1 .venv/bin/python -m pytest tests/quality/test_length.py -v -s
```

Long clips sit next to the fast ones in `$SONORUS_EVAL_CACHE/ami` (`es2002b-10m/`, `es2002b-full/`, …), are listed under `long` in the manifest and are skipped by a rebuild once built.

### Recomputing thresholds

Every run also saves the voices of every clip as `<date-time>.npz` next to the report: the diarization turns with their embeddings and who they really are, and which turn each transcript segment carries. `scripts/eval/threshold_sweep.py` replays the runs of a report from them — the resolver, the queue's commit with the guard, naming — for other thresholds and ways of averaging the embeddings, without the models:

```bash
.venv/bin/python scripts/eval/threshold_sweep.py ~/.cache/sonorus-eval/reports/<date-time>.json
```

It prints recognised / wrong for each threshold and method over all runs, and per run the own and best other similarity at the app's threshold. Diarization and embeddings stay those of the run, so the replay matches the run at the app's threshold and method.

What it can vary (the script's docstring has the details):

- **Averaging** (`--methods`): the plain mean, as the app averaged before `voice_vector` (`mean`); embeddings scaled to length 1 first (`norm`); also weighted by the duration of their diarization turn (`norm+dur`); and `one`, a single definition for the voice `resolve()` compares and a profile's per-recording centroid: `norm+dur` over the turns, each turn once however many segments carry it. The other methods count a turn once per segment in a profile. The app averages as `one`: a profile counts each turn the speaker holds most of once, with its duration.
- **Matching** (`--matchers`): `greedy` takes the highest pair first, as the app; `hungarian` takes the one-to-one assignment with the largest sum of similarities at or above the threshold.
- **Margin** (`--margins`): a match less than the margin above the voice's next best profile counts as a possible match, as one below `POSSIBLE_MATCH_CEILING` does in the app. The matcher tables split recognised and wrong into possible and sure matches.

It also prints the own and best other similarity on the 3-minute call clips for each method. The replay takes a turn's duration from the run; the app's database holds segment times, not turns.

### Speaker recognition threshold

`SPEAKER_SIMILARITY_THRESHOLD` (`0.6`) was chosen with the threshold sweep over the fast and the long set (WeSpeaker embeddings, November 2026):

| Threshold | Recognised | Wrong |
|---|---|---|
| 0.75 | 122 / 178 | 0 |
| 0.70 | 163 / 178 | 0 |
| 0.65 | 174 / 178 | 0 |
| **0.60** | **175 / 178** | **0** |
| 0.55 | 178 / 178 | 0 |
| 0.40 | 178 / 178 | 1 |

The same person in another recording scored 0.56–0.95 (5 % below 0.69); the length of the recordings matters most: on whole meetings the lowest was 0.78, on 3-minute clips 0.56. Other people scored at most 0.49, with three groups of four in one memory (IS1009 is four women). 0.6 keeps about 0.1 between the threshold and the highest other person, because real calls differ more than one meeting room; most of the people it misses are on 3-minute call clips. These numbers are for the plain mean the app used then; see [Voice averaging](#voice-averaging) for the averaging that replaced it, with which the threshold stayed.

### Voice averaging

A voice is averaged by `voice_vector()` (`app/services/voice_vector.py`): embeddings scaled to length 1 and weighted by how long each one speaks, for the voice `resolve()` compares, a profile's per-recording centroid and a voice's candidates. It replaced the plain mean, chosen with the sweep on the fast and the long set at the app's threshold of 0.6 (WeSpeaker embeddings from exclusive turns, November 2026):

| Averaging | Recognised | Wrong | Possible matches | Lowest own − highest other |
|---|---|---|---|---|
| plain mean (`mean`) | 192 / 194 | 0 | 15 | 0.23 |
| scaled to length 1 (`norm`) | 191 / 194 | 0 | 15 | – |
| **weighted by duration (`one`)** | **194 / 194** | **0** | **8** | **0.33** |

The lowest own scores of the plain mean came from short turns weighing as much as long ones; scaling alone changes nothing, the weight does. A margin over the next best profile (0.05, 0.1) and Hungarian matching changed nothing on this set, where no voice is close to two profiles, so the app matches greedily without a margin. Profiles stored by an earlier version are recomputed once when the backend starts (`CommitService.recompute_outdated_profiles()`).

A quality run of both sets with the models (the app as is, against the plain mean in the same environment) confirmed the replay. Transcription is untouched: WER and speaker words are the same in every variant. Recognition is what changes:

| Averaging | Recognised | Wrong | Possible matches | Lowest own − highest other |
|---|---|---|---|---|
| plain mean | 195 / 198 | 0 | 12 | 0.22 |
| **weighted by duration** | **197 / 198** | **0** | **11** | **0.26** |

The two recognitions gained are a quiet participant of the clean 10-minute clip, missed at 0.59 and now a possible match at 0.66 (in "10 min" and in "three groups"). The one still missed (0.54, clean "three groups") is the same voice in both.

## Padded set

The AMI clips are speech from the first second to the last, in one language. A real recording often starts with silence, a ring tone or hold music, and pauses in it. The padded set puts such sounds before the speech of English, Russian and Ukrainian recordings, for what they do to language detection (and, with inserts between sentences, to text Whisper invents over non-speech).

**Bases** (`tests/quality/padded_manifest.json`, `bases`):

| Base | Source |
|---|---|
| `es2002b-clean` … `es2002d-call` | The fast set's `clean.wav` and `call.wav` (English) |
| `ru1`–`ru3`, `uk1`–`uk3` | Russian and Ukrainian read speech of [FLEURS](https://huggingface.co/datasets/google/fleurs) (CC BY 4.0), its dev split: 13–18 utterances per clip, about 3 minutes, one recording per sentence with female and male readers alternating, 0.6–1.2 s pauses between them, each utterance brought to −30 dBFS speech level as the AMI tracks |

**Inserts** (`inserts`): digital silence (`silence`), pink noise at −50 dBFS as a quiet room (`room`), a ring-back tone of 425 Hz, 1 s on and 4 s off, at −30 dBFS (`ring`), and instrumental hold music at −30 dBFS RMS, as loud as the speech (`music`: "Local Forecast – Elevator" by Kevin MacLeod, incompetech.com, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Local_Forecast_-_Elevator_(ISRC_USUAN1300012).mp3)). Each insert fades in and out over 20 ms.

**Variants** (`variants`): each insert before the speech for 15 s (Whisper's first 30 s still hold speech) and for 45 s (they hold none): `silence15` … `music45`. A variant may also list `gaps`, inserts at a second of the base, put in a pause; the reference is shifted past every insert at or before a word.

`scripts/eval/build_padded_set.py` builds it into `$SONORUS_EVAL_CACHE/padded` (about 760 MB): per base `base.wav` and each `<variant>.wav`, with `.json` next to it holding the language, the inserts (where, what, how long) and the reference shifted by them: AMI words, FLEURS sentences with their times. The FLEURS archives (about 180 MB per language) are downloaded once from a fixed revision of the dataset and deleted once the utterances are taken out; every download is checked against the sha256 in the manifest. The build is deterministic.

```bash
.venv/bin/python scripts/eval/build_ami_set.py      # the AMI bases, if not built yet
.venv/bin/python scripts/eval/build_padded_set.py
```

`--record` fills in missing sha256 values and picks the utterances of a clip whose list in the manifest is empty.

### Language detection

`tests/quality/test_language.py` (part of `SONORUS_QUALITY=1`, or on its own) detects the language of every recording of the padded set two ways: as WhisperX does on its own, from the first 30 s of the file, and as the app does, from the speech VAD found ([TranscriptionService](../services/TranscriptionService.md#transcribeaudio_path--result-audio-diarization)). Only VAD and Whisper's encoder run; the 12 bases with 9 recordings each take about a minute and a half on an 8 GB GPU, models loaded. A base's test fails if the app's way gets any of its recordings wrong; the old way is reported. One more test runs `transcribe()` itself on a recording with 45 s of room noise first and checks that the language came from the speech after it: a WhisperX update that changes the order inside `transcribe()` fails there.

```bash
SONORUS_QUALITY=1 .venv/bin/python -m pytest tests/quality/test_language.py -v -s
```

Results (November 2026, Whisper `large-v3`, 108 recordings, 12 per lead-in):

| Lead-in | Old way right | App's way right | App's lowest probability |
|---|---|---|---|
| none | 12 | 12 | 0.88 |
| silence, 15 s | 12 | 12 | 0.83 |
| silence, 45 s | 6 | 12 | 0.87 |
| room noise, 15 s | 12 | 12 | 0.88 |
| room noise, 45 s | 0 | 12 | 0.89 |
| ring tone, 15 s | 12 | 12 | 0.89 |
| ring tone, 45 s | 0 | 12 | 0.85 |
| music, 15 s | 12 | 12 | 0.90 |
| music, 45 s | 6 | 12 | 0.86 |

With 45 s of non-speech first, the old way sees none of the speech: silence and music came out English (right only for the English bases), room noise and the ring tone Norwegian Nynorsk, at probabilities of 0.31–0.38. The app's way got every recording right, the Russian and Ukrainian ones at 0.93–1.00 and never one for the other; the English call clips are the least sure, down to 0.83. One recording needed more windows (`es2002c-call` with 45 s of ring tone: 0.85 over three). VAD takes the ring tone and parts of the music for speech (the speech "starts" at 0 s and at 15.5 s); 30 s of speech still hold enough of the real speech for Whisper there.

## Report

At the end, pytest prints a Markdown report and saves it as `$SONORUS_EVAL_CACHE/reports/<date-time>.md`, with the raw results next to it as `<date-time>.json` (which also holds each person's own and best other similarity per clip, under `scores`, for choosing thresholds) and the voices as `<date-time>.npz` (see [Recomputing thresholds](#recomputing-thresholds)). It holds the models, device and library versions of the run, a summary per variant, the words recognised per speaker, the segment counts above per variant and per clip, every clip (WER split into substitutions / deletions / insertions, speakers found, detected language, time), the text of each missed utterance with its level, and, when the language test ran, its results per lead-in and per recording. Numbers depend on the versions of the models and libraries, so variants are compared within one run, never with numbers from another one. Reports are not kept in the repository.
