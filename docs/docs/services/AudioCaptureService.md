---
sidebar_position: 8
---

# Audio Capture Service

`AudioCaptureService` manages live system audio recording sessions. It abstracts over three platform-specific capture tools — the renderer calls HTTP only, with no platform detection in JavaScript.

---

## Why a Python backend, not the renderer

Electron's WebRTC layer (`getDisplayMedia`) cannot capture system audio reliably across all platforms:

- **macOS** — returns a video-only stream; the "Share computer sound" toggle does not appear. ScreenCaptureKit audio requires a native entitlement that Chromium/Electron do not expose.
- **Linux** — PulseAudio/PipeWire monitor sources do not appear in `enumerateDevices()` inside Electron's sandboxed renderer.
- **Windows** — Electron's loopback (`setDisplayMediaRequestHandler` with `audio: 'loopback'`) records only the default output device and would need its own mixing path in the renderer; one backend path for all OSes gives every recording the same merge and loudness levelling.

Running capture in a Python subprocess sidesteps these restrictions and keeps all platform logic in one place.

---

## Platform drivers

Each OS has a driver class in `audio_capture_service.py` behind one interface: `sources()`, `check(source_id)` (raises `RuntimeError` with a user-facing reason) and `command(source_id, output_path)`; two class attributes say how the process starts and stops — `handshake` (prints `READY` on stdout once capturing) and `stop_via_stdin` (`stop` on stdin instead of SIGINT). The service picks the driver from `sys.platform` on every call; everything around the capture process (start-up check, stop, mic merge, moving into `recordings/`) is shared.

| Platform | Driver | Tool | How it works |
|---|---|---|---|
| macOS | `_MacCapture` | `sonorus-capture` (Swift binary, ScreenCaptureKit) | Spawned as a subprocess; prints `READY` once capturing; writes WAV to an intermediate temp file; stopped with SIGINT |
| Linux | `_LinuxCapture` | `parec -d <monitor_source> --file-format=wav --rate=48000 --channels=2 --latency-msec=100` | PulseAudio / PipeWire monitor source recorded directly; sources enumerated via `pactl list short sources` |
| Windows | `_WindowsCapture` | `sonorus-capture.exe` (C++, WASAPI loopback) | `--list` gives the output devices; spawned with `--device <id> --output <wav>`; prints `READY`; writes silence while nothing plays; stopped with `stop` on stdin (Windows has no SIGINT for a child process) |

### Start errors

`POST /audio/capture/start` returns `400` with the reason when capture cannot run, before any recording starts:

| Case | Detail |
|---|---|
| macOS helper missing | `sonorus-capture binary not found; run: npm run build:capture` |
| macOS helper does not print `READY` within 5 s | `sonorus-capture timed out starting.` / `sonorus-capture failed to start: <stderr>` |
| Linux: `parec` not on `PATH` | names `parec` and the package to install (`pulseaudio-utils`, `libpulse` on Arch Linux) |
| Linux: the selected monitor source is not in the `pactl` list | `The selected system audio source is not available: <id>. …` — PipeWire would otherwise silently record the default source |
| Linux: capture process exits within 0.5 s | `System audio capture failed to start: <stderr>` (e.g. no sound server) |
| Windows helper missing | `The system audio capture helper (sonorus-capture.exe) was not found; run: npm run build:capture:win` |
| Windows: no active output device | `No audio output device was found. …` |
| Windows: the selected output device is not in the `--list` output | `The selected system audio source is not available: <id>. …` |
| Windows helper exits or does not print `READY` within 5 s | `sonorus-capture failed to start: <stderr>` (e.g. `ERROR: could not open the output device (0x…)`) / `sonorus-capture timed out starting.` |

When the stopped capture file is empty, `stop_capture()` raises the driver's own message: the Screen Recording permission hint on macOS, `No system audio was captured from the selected source.` on Linux, `No system audio was captured from the selected output device.` on Windows. The renderer (`captureStartError()` in `utils.js`) shows the Screen Recording hint only on macOS.

---

## Job lifecycle

```
POST /audio/capture/start
  → AudioCaptureService.start_capture(source_id)
  → driver.check(source_id) — 400 with the reason if capture cannot run
  → spawns platform process (stderr → sonorus-sys-<job_id>.log, never a pipe)
  → macOS / Windows: waits up to 5 s for READY (first stdout line read on a thread —
    select() works only on sockets on Windows); Linux: a process that exits within 0.5 s
    → 400 with its stderr
  → stores { process, output_path, log_path } under job_id
  → returns job_id

[user records...]

POST /audio/capture/stop/{job_id}  { mic_path?: "..." }
  → macOS / Linux: sends SIGINT to the capture process; Windows: writes "stop" to its
    stdin and closes it
  → process.wait(timeout=10), kill() if it does not exit
  → reads the log file tail, logs it (logging.warning) and deletes it
  → logs output file size
  → no mic_path: level the loudness of the capture file (ffmpeg dynaudnorm) into
    $SONORUS_DATA_DIR/recordings/sonorus-rec-<job_id>.wav; delete the temp capture file
  → mic_path: level both tracks and mix them into the same final path; delete the temp
    capture file and the mic file (only if it lives inside the recordings dir)
  → returns final WAV path

POST /queue/jobs  { audio_path: "<returned path>" }
```

`has_active_jobs()` reports whether any capture is still running; `POST /data/reset` returns `409` while it is `True`, so a reset never races with a file being written into the recordings directory.

Mic recording (WebM via `MediaRecorder`) is uploaded by the renderer to `POST /audio/recordings`, which stores it in `$SONORUS_DATA_DIR/recordings/` (`audio_store.save_recording()`). The returned path is passed as `mic_path` to `stop_capture`, so the mic file is always inside the recordings dir and is removed after the merge.

Final recordings are never kept in the OS temp directory: their path is stored in `transcriptions.audio_file`, and `/tmp` is wiped on reboot on many systems (e.g. `tmpfs`).

---

## `sonorus-capture` — macOS Swift binary

### Purpose

Captures system audio on macOS using ScreenCaptureKit and writes a WAV file. Runs as a subprocess of `AudioCaptureService`; stops cleanly on SIGINT/SIGTERM.

### Building

```bash
npm run build:capture
# produces: electron/resources/mac/sonorus-capture
```

The binary is gitignored. It must be rebuilt on each macOS development machine.

The build command:
```bash
swiftc -O native/macos/sonorus-capture/main.swift \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework Foundation \
  -o electron/resources/mac/sonorus-capture
```

### Running standalone

```bash
./electron/resources/mac/sonorus-capture --output /tmp/test.wav
# record for a few seconds
# Ctrl+C to stop
ls -la /tmp/test.wav
afplay /tmp/test.wav
```

All diagnostic output (errors, stream issues) goes to stderr. In normal operation the binary is silent.

### Permissions

Screen Recording permission must be granted once in **System Settings → Privacy & Security → Screen Recording** for the terminal or app that launches the server.

For distribution builds, the entitlement `com.apple.security.screen-capture` is declared in `build/entitlements.mac.plist`.

### How it works internally

```
SCShareableContent.current        → get list of displays
SCContentFilter(display:)         → capture the primary display (audio only)
SCStreamConfiguration
  capturesAudio = true
  excludesCurrentProcessAudio = true
  minimumFrameInterval = 1/1 s    → minimal video (2×2 px) to satisfy SCStream
SCStream → addStreamOutput(.audio)

AudioWriter.stream(_:didOutputSampleBuffer:of:)
  → on first buffer: construct AVAudioFormat(int16, 48 kHz, stereo, interleaved)
  → AVAudioFile(forWriting: url, settings: int16Fmt.settings)
  → per buffer: CMSampleBufferCopyPCMDataIntoAudioBufferList → AVAudioPCMBuffer
  → AVAudioFile.write(from:)

SIGINT → keepRunning = false → stream.stopCapture() → writer.close()
```

**Output format:** 16-bit PCM, 48 kHz, stereo, interleaved WAV — readable by ffmpeg and WhisperX without conversion.

### Key fix: CMSampleBuffer extraction

`CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer` fails on SCK buffers with `kCMSampleBufferError_BufferHasNoSampleSizes` (-12737). SCK audio buffers do not carry per-sample size metadata that this API requires.

The correct API for SCK audio is `CMSampleBufferCopyPCMDataIntoAudioBufferList`, which copies PCM data directly into a pre-allocated `AVAudioPCMBuffer`:

```swift
CMSampleBufferCopyPCMDataIntoAudioBufferList(
    self, at: 0, frameCount: numFrames, into: pcm.mutableAudioBufferList
)
```

---

## `sonorus-capture.exe` — Windows WASAPI helper

### Purpose

Records what an output device plays (WASAPI loopback) into a WAV file. Runs as a subprocess of `AudioCaptureService`; source: `native/windows/sonorus-capture/main.cpp` (C++17, Windows APIs only — no third-party libraries).

### Interface

```
sonorus-capture.exe --list
  → [{"id": "{0.0.0.00000000}.{…}", "label": "Speakers (Realtek)", "default": true}, …]
sonorus-capture.exe --device <endpoint id | default> --output <file.wav>
  → READY on stdout once capture runs; "stop" or EOF on stdin ends it; exit 0
  → errors before READY: "ERROR: … (0x<HRESULT>)" on stderr, exit 2
```

`GET /audio/capture/sources` lists `{"id": "default", "label": "System audio (default)"}` first (the default output device when the recording starts), then every active output device by name. The chosen device stays fixed for the whole recording.

### Recording

- **Format:** the device's mix format (usually 32-bit float, 48 kHz) converted to 16-bit PCM WAV at the device's sample rate; more than two channels are folded into stereo.
- **Real time:** WASAPI delivers no packets while nothing plays. The helper polls every 10 ms, places each packet by its timestamp (`u64QPCPosition`) and fills gaps with silence; with no packets at all it adds silence by the clock (lagging 150 ms behind, so late packets still fit). The file lasts as long as the recording, so the mix with the mic stays in sync.
- **Lost device** (unplugged, disabled): `WARNING: the output device was lost; recording silence until stop` on stderr (logged by the backend at stop); the recording continues with silence.
- **Stop:** `stop` on stdin or EOF (also when the backend dies) → silence up to the current moment, final header, exit 0. The WAV header is rewritten every second, so the file stays readable if the helper is killed.

### Building

```bash
npm run build:capture:win
# produces: electron/resources/win/sonorus-capture.exe
```

`scripts/build-capture-win.js` uses MSVC on Windows (`cl` from a Developer prompt, or found with `vswhere`; `/MT`, so the helper needs no VC++ runtime) and mingw-w64 elsewhere (`x86_64-w64-mingw32-g++ -static`; Arch: `mingw-w64-gcc`, Debian/Ubuntu: `g++-mingw-w64-x86-64`). `npm run build:win` and the CI Windows build run it first; the CI test job compiles it with mingw-w64 on every push (it cannot run there). The binary is gitignored.

---

## Linux: parec and monitor sources

`GET /audio/capture/sources` runs `pactl list short sources` and filters for lines containing `"monitor"`:

```
$ pactl list short sources
42  alsa_output.pci-0000_00_1f.3.analog-stereo.monitor  ...
```

The monitor source ID is passed to `parec -d <id>`. If `pactl` is missing, fails, or lists no monitor sources, the endpoint returns one source, `{"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}` — the monitor of the default output device — so "System audio" is always offered; a missing `parec` is reported when recording starts.

`parec` and `pactl` come from the same package (`pulseaudio-utils`; `libpulse` on Arch Linux) and work with both PulseAudio and PipeWire (`pipewire-pulse`). The bundled `ffmpeg` (`ffmpeg-static`) is built without PulseAudio input, so it is used only for the mic merge and decoding, never for capture.

`--latency-msec=100` keeps `parec`'s buffer small: with its default (about 2 s) the tail of the recording is still buffered when SIGINT arrives and is lost. On SIGINT `parec` closes the file and writes the final WAV header.

---

## Loudness levelling and mic merge

Every recording that holds system audio is levelled before it is stored. System audio is often 15–20 dB quieter than the mic, and the participants of a call differ too; with the tracks mixed as is, the voice activity detection joins the recording into one long chunk and Whisper drops the quiet speech even though it is audible in the player.

Each track goes through `dynaudnorm` (`_LEVEL_FILTER` in `audio_capture_service.py`):

| Option | Value | Why |
|---|---|---|
| `f` / `g` | 150 ms / 11 frames | ~1.7 s window: follows a change of speaker; a ~15 s window leaves alternating quiet and loud speakers 30 dB apart |
| `m` | 100 | up to +40 dB; the default (+20 dB) barely closes a 20 dB gap |
| `t` | 0.001 | frames below −60 dBFS are not boosted: silence stays silent, faint background noise is not raised to hiss |
| `r` | 0.15 | target RMS (≈ −16 dBFS per frame): tracks match in loudness, not in peaks — call and media audio is already compressed and would sound several dB louder than a peaky mic voice at equal peaks |
| `p` | 0.9 | peak ceiling |

System audio only (`stop_capture()` without `mic_path`):

```bash
ffmpeg -y -i <system.wav> -af "<level filter>" <final.wav>
```

Mic + system (`stop_capture(mic_path=...)`):

```bash
ffmpeg -y \
  -i <system.wav> -i <mic.webm> \
  -filter_complex "[0:a]<level filter>[sys];[1:a]<level filter>[mic];[sys][mic]amix=inputs=2:duration=shortest:normalize=0,alimiter=limit=0.95:level=disabled" \
  <merged.wav>
```

`normalize=0` sums the tracks instead of dividing each by the number of inputs; `alimiter` keeps the sum from clipping. `duration=shortest` ensures the merged file ends when the shorter track ends, avoiding silence padding if the two recordings differ slightly in length. The result is the same WAV as before (16-bit PCM).

If the levelling run fails (ffmpeg error or ffmpeg not found), a warning is logged and the recording is stored without levelling: the system-only file is moved as captured, the mix is retried with plain `amix=inputs=2:duration=shortest`. Only a failure of that plain mix fails the stop.

Mic-only recordings (renderer `MediaRecorder`, `POST /audio/recordings`) and imported files are not levelled; Chromium's `getUserMedia` already applies automatic gain control to the mic.

---

## Source files

| File | Description |
|---|---|
| `app/services/audio_capture_service.py` | Python service — platform drivers, job management, loudness levelling and ffmpeg merge |
| `app/api/routers/audio_capture.py` | FastAPI router — `/audio/capture/*` endpoints |
| `app/api/dependencies.py` | `get_audio_capture_service()` singleton |
| `native/macos/sonorus-capture/main.swift` | Swift binary — ScreenCaptureKit capture |
| `native/windows/sonorus-capture/main.cpp` | C++ helper — WASAPI loopback capture (Windows) |
| `scripts/build-capture-win.js` | Builds `sonorus-capture.exe` (MSVC or mingw-w64) |
| `electron/backend.js` | Sets `SONORUS_CAPTURE_BIN` env var so the server finds the helper (macOS, Windows) |
| `build/entitlements.mac.plist` | `com.apple.security.screen-capture` entitlement for signed builds |

:::note[Why stderr is not a pipe]
The capture process runs for the whole recording. An unread `stderr=PIPE` fills its 64 KB buffer once the process writes enough diagnostics; the process then blocks on `write()`, stops capturing, and never exits on SIGINT — `stop_capture()` would hang forever. stderr is therefore redirected to a log file.
:::
