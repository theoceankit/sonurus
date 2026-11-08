---
sidebar_position: 12
---

# Waveform

`app/services/waveform.py` works out the loudness of a recording for the player's waveform in the UI ([Player](../ui/electron/player.md)), and `GET /transcripts/{id}/waveform` turns it into the heights of bars.

---

## Why on the backend

The renderer could decode the audio with Web Audio, but Chromium first expands the whole file into 32-bit samples at 48 kHz: an hour takes about 3 GB and a few seconds, and three hours fail to decode at all. ffmpeg on the backend streams the audio through a pipe instead, so memory stays at a few megabytes however long the recording is; three hours take 2–9 seconds depending on the format (WAV fastest, Opus slowest). ffmpeg ships with the app already ([Audio Capture](AudioCaptureService.md), WhisperX), and nothing contacts a server.

---

## Levels

### `compute_levels(audio_path) → np.ndarray`

Runs `ffmpeg -i <audio> -ac 1 -ar 8000 -f s16le -` and keeps the loudness of every 50 ms window (`WINDOWS_PER_SECOND = 20`) in dBFS: the mean power of the window's samples, down to `FLOOR_DB` (−96 dB) for silence. Raises `WaveformError` when ffmpeg is missing or cannot read the file.

### `ensure_levels(audio_path, recordings_dir) → np.ndarray`

The levels from the cache, or worked out and cached. The cache is `<audio file name>.levels` next to the audio in `RECORDINGS_DIR`: a header (`SNRL`, version) and one byte per window from −96 to 0 dB, about 216 KB for three hours. It is written as `.levels.part` and renamed, and one lock per file makes a second request wait for the first instead of running ffmpeg again. A cache that cannot be read is worked out again. Audio outside `recordings_dir` is read every time: nothing is written next to the user's own files. Raises `FileNotFoundError` when the audio is gone.

The queue calls it after saving a transcript (`transcription_job.py`), so the levels are there when the recording is first opened; a failure is logged and the job is still done. The route calls it for recordings made before.

The cache goes wherever its audio goes: see [Audio Store](AudioStore.md) → Lifecycle.

---

## Bars

### `bar_levels(db, bars, start, end) → list[float]`

Heights from 0 to 1 for `bars` evenly over `start`…`end` seconds:

- A bar is the mean power of the windows it covers, so one loud second and one silent second are 3 dB below the loud one, not halfway in decibels. A bar narrower than a window takes the window its middle falls in.
- Past the end of the audio is silence. The player asks over the length its speakers are laid over, which for audio with no length in the file is the end of the last segment.
- The scale is the loud part of the whole recording: the 95th percentile (`REFERENCE_PERCENTILE`) of the windows above −70 dB is the top, and `RANGE_DB` (45 dB) below it is zero. A quiet recording therefore fills the height like a loud one, a quiet voice stays visibly lower than a loud one without vanishing, and a clip has the scale of the recording it comes from. A recording that is all silence is all zero.

The values were chosen on real meetings with uneven voices: 35 dB turned quiet voices into dots, 60 dB and the loudest window instead of the mean power made a wall with no pauses.
