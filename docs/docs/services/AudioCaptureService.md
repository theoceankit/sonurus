---
sidebar_position: 8
---

# Audio Capture Service

`AudioCaptureService` records the tracks of a live recording — system audio and the microphone, one capture process per track — and leaves one file in `recordings/`. It abstracts over three platform-specific capture tools — the renderer calls HTTP only, with no platform detection in JavaScript.

---

## Why the backend, not the window

Electron's WebRTC layer (`getDisplayMedia`) cannot capture system audio reliably across all platforms:

- **macOS** — returns a video-only stream; the "Share computer sound" toggle does not appear. ScreenCaptureKit audio requires a native entitlement that Chromium/Electron do not expose.
- **Linux** — PulseAudio/PipeWire monitor sources do not appear in `enumerateDevices()` inside Electron's sandboxed renderer.
- **Windows** — Electron's loopback (`setDisplayMediaRequestHandler` with `audio: 'loopback'`) records only the default output device and would need its own mixing path in the renderer; one backend path for all OSes gives every recording the same merge and loudness levelling.

The microphone is recorded by the backend too: a recording made in the window would end with the window, and the app may close its window while it keeps running. Both tracks on one clock also line up better.

Running capture in subprocesses of the backend sidesteps these restrictions and keeps all platform logic in one place.

---

## Platform drivers

Each OS has a driver class in `audio_capture_service.py` behind one interface: `sources()` (system audio), `inputs()` (microphones; the default one is not listed, its source id is `None`), `check(source_id, kind)` (raises `RuntimeError` with a user-facing reason) and `command(source_id, output_path, kind)`, `kind` being `system` or `mic`; two class attributes say how the process starts and stops — `handshake` (prints `READY` on stdout once capturing) and `stop_via_stdin` (`stop` on stdin instead of SIGINT). The service picks the driver from `sys.platform` on every call; everything around the capture process (start-up check, stop, mic merge, moving into `recordings/`) is shared.

| Platform | Driver | Tool | How it works |
|---|---|---|---|
| macOS | `_MacCapture` | `sonorus-capture` (Swift binary, ScreenCaptureKit; `--input`: AVCaptureSession) | Spawned as a subprocess; prints `READY` once capturing; writes WAV to an intermediate temp file; stopped with SIGINT; `--list-inputs` gives the microphones |
| Linux | `_LinuxCapture` | `parec -d <source> --file-format=wav --rate=48000 --channels=2 --latency-msec=100` (microphone: `--channels=1`) | PulseAudio / PipeWire source recorded directly; system audio: "System audio (default)" first, then each output device's monitor named after the device (`pactl -f json list sinks`); microphone: each input source (`pactl -f json list sources` without monitors) |
| Windows | `_WindowsCapture` | `sonorus-capture.exe` (C++, WASAPI loopback; `--input`: an input device) | `--list` gives the output devices, `--list --input` the input devices; spawned with `[--input] --device <id> --output <wav>`; prints `READY`; writes silence while nothing plays; stopped with `stop` on stdin (Windows has no SIGINT for a child process) |

### Start errors

`POST /audio/recording/start` returns `400` with the reason when a track cannot run, before any recording starts:

| Case | Detail |
|---|---|
| macOS helper missing | `sonorus-capture binary not found; run: npm run build:capture` |
| macOS helper does not print `READY` within 5 s | `sonorus-capture timed out starting.` / `sonorus-capture failed to start: <stderr>` |
| Linux: `parec` not on `PATH` | names `parec` and the package to install (`pulseaudio-utils`, `libpulse` on Arch Linux) |
| Linux: the selected monitor source is not in the `pactl` list | `The selected system audio source is not available: <id>. …` — PipeWire would otherwise silently record the default source |
| Linux: capture process exits within 0.5 s | `System audio capture failed to start: <stderr>` (e.g. no sound server) |
| Windows helper missing | `The audio capture helper (sonorus-capture.exe) was not found; run: npm run build:capture:win` |
| Windows: no active output device | `No audio output device was found. …` |
| Windows: the selected output device is not in the `--list` output | `The selected system audio source is not available: <id>. …` |
| Windows helper exits or does not print `READY` within 5 s | `sonorus-capture failed to start: <stderr>` (e.g. `ERROR: could not open the output device (0x…)`) / `sonorus-capture timed out starting.` |

When the stopped capture file is empty, `stop_capture()` raises the driver's own message: the Screen Recording permission hint on macOS, `No system audio was captured from the selected source.` on Linux, `No system audio was captured from the selected output device.` on Windows. The microphone's own: `No audio was captured from the microphone.` The UI (`captureStartError()` in `ui/src/recording/sources.ts`) shows the Screen Recording hint only on macOS.

---

## Job lifecycle

`LiveRecordingService` ([Live Recording Service](./LiveRecordingService.md)) drives one capture job per track of a recording:

```
start_capture(source_id, kind)        kind "mic" or "system"
  → driver.check(source_id, kind) — RuntimeError with the reason if capture cannot run
  → spawns the platform process (stderr → sonorus-mic-<job_id>.log / sonorus-sys-<job_id>.log,
    never a pipe; output to sonorus-mic-<job_id>.wav / sonorus-sys-<job_id>.wav in the OS temp dir)
  → macOS / Windows: waits for READY (5 s; 120 s for a macOS microphone, so the user can answer
    the permission prompt), the first stdout line read on a thread — select() works only on
    sockets on Windows; Linux: a process that exits within 0.5 s fails the start with its stderr
  → stores { process, output_path, log_path, started_at, kind } under job_id; started_at is
    time.time() when the track starts: at READY on macOS / Windows (the helper writes from there
    on), at the spawn on Linux
  → returns job_id

alive(job_id)                          False once the process ended by itself (a lost source)

stop_recording(system_job, mic_job)   either or both
  → the microphone first: SIGINT (Windows: "stop" on stdin), wait up to 10 s, kill() if it hangs;
    its log tail is logged and deleted; an empty file fails with
    "No audio was captured from the microphone."
  → then system audio through stop_capture(system_job, mic_path, mic_started_at): the same stop,
    then the levelling and mix below into $SONORUS_DATA_DIR/recordings/sonorus-rec-<job_id>.wav
  → a microphone alone is moved there as recorded (sonorus-rec-<mic job_id>.wav)
  → temp files are removed whatever happens; a failure discards the other track

discard(job_id) / discard_all()       kill the process, remove its files, keep nothing
```

`has_active_jobs()` reports whether any capture is still running. The routes that must not race with a recording (`POST /data/reset`, deleting a speaker, a GPU restart) ask `LiveRecordingService.is_recording()`, which also covers the mix after the tracks stopped.

Final recordings are never kept in the OS temp directory: their path is stored in `transcriptions.audio_file`, and `/tmp` is wiped on reboot on many systems (e.g. `tmpfs`).

---

## `sonorus-capture` — macOS Swift binary

### Purpose

Captures system audio on macOS using ScreenCaptureKit, or the microphone using AVCaptureSession (`--input`), and writes a WAV file. Runs as a subprocess of `AudioCaptureService`; stops cleanly on SIGINT/SIGTERM.

```
sonorus-capture --output <file.wav>                         → system audio
sonorus-capture --list-inputs                               → [{"id": "<uniqueID>", "label": "<name>", "default": true|false}, …]
sonorus-capture --input <uniqueID | default> --output <file.wav>  → the microphone, mono 16-bit PCM, 48 kHz
```

With `--input` the helper asks for microphone access first (`AVCaptureDevice.requestAccess`); the system shows the prompt once, for the app that started the backend — Sonorus in the packaged app, whose `Info.plist` carries `NSMicrophoneUsageDescription` (`build.mac.extendInfo` in `package.json`), the terminal in development. The backend waits up to 120 s for `READY` on a microphone start, so the user has time to answer. Refused: `ERROR: microphone access denied`, exit 2, and the start fails with `Sonorus may not use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.` A microphone disconnected while recording (`AVCaptureDeviceWasDisconnected`, or a session runtime error) closes the file: `ERROR: the microphone was lost`, exit 3. The capture output is asked for mono 32-bit float at 48 kHz, the processing format of the file, so buffers are written without conversion.

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

Screen Recording permission must be granted once in **System Settings → Privacy & Security → Screen Recording** for the terminal or app that launches the server; microphone access the same way under **Microphone** (the helper asks for it on the first microphone recording).

For distribution builds, the entitlements `com.apple.security.screen-capture` and `com.apple.security.device.audio-input` are declared in `build/entitlements.mac.plist` (inherited by the helper).

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

Records what an output device plays (WASAPI loopback) or, with `--input`, what an input device hears (the microphone) into a WAV file. Runs as a subprocess of `AudioCaptureService`; source: `native/windows/sonorus-capture/main.cpp` (C++17, Windows APIs only — no third-party libraries).

### Interface

```
sonorus-capture.exe --list [--input]
  → [{"id": "{0.0.0.00000000}.{…}", "label": "Speakers (Realtek)", "default": true}, …]
sonorus-capture.exe [--input] --device <endpoint id | default> --output <file.wav>
  → READY on stdout once capture runs; "stop" or EOF on stdin ends it; exit 0
  → errors before READY: "ERROR: … (0x<HRESULT>)" on stderr, exit 2
  → --input, microphone off for desktop apps (E_ACCESSDENIED): "ERROR: microphone access denied", exit 2
  → --input, microphone lost while recording: the file is closed, "ERROR: the microphone was lost", exit 3
```

`GET /audio/capture/inputs` lists the input devices by name (`--list --input`); the default microphone is the default input device when the recording starts. With no input device the start fails with `No microphone was found. …`, with a chosen one no longer listed with `The selected microphone is not available: <id>. …`. A microphone switched off in **Settings → Privacy & security → Microphone → Let desktop apps access your microphone** fails the start with a message that says so.

`GET /audio/capture/sources` lists `{"id": "default", "label": "System audio (default)"}` first (the default output device when the recording starts), then every active output device by name. The chosen device stays fixed for the whole recording.

### Recording

- **Format:** the device's mix format (usually 32-bit float, 48 kHz) converted to 16-bit PCM WAV at the device's sample rate; an output's channels are folded into stereo at most, an input is folded into mono.
- **Real time:** WASAPI delivers no packets while nothing plays. The helper polls every 10 ms, places each packet by its timestamp (`u64QPCPosition`) and fills gaps with silence; with no packets at all it adds silence by the clock (lagging 150 ms behind, so late packets still fit). The file lasts as long as the recording, so the mix with the mic stays in sync.
- **Lost device** (unplugged, disabled): an output device — `WARNING: the output device was lost; recording silence until stop` on stderr (logged by the backend at stop), the recording continues with silence; an input device — the file is closed and the helper exits with code 3, so the backend sees the track end by itself.
- **Stop:** `stop` on stdin or EOF (also when the backend dies) → silence up to the current moment, final header, exit 0. The WAV header is rewritten every second, so the file stays readable if the helper is killed.

### Building

```bash
npm run build:capture:win
# produces: electron/resources/win/sonorus-capture.exe
```

`scripts/build-capture-win.js` uses MSVC on Windows (`cl` from a Developer prompt, or found with `vswhere`; `/MT`, so the helper needs no VC++ runtime) and mingw-w64 elsewhere (`x86_64-w64-mingw32-g++ -static`; Arch: `mingw-w64-gcc`, Debian/Ubuntu: `g++-mingw-w64-x86-64`). `npm run build:win` and the CI Windows build run it first. Like the macOS helper, it is compiled only by release builds, not by the test job. The binary is gitignored.

---

## Linux: parec and monitor sources

`GET /audio/capture/sources` lists `{"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}` first — the monitor of the default output device when the recording starts, as on Windows — then one source per output device: its monitor source as the id, the device's own name as the label (the sink description, as in the system sound settings):

```
$ LC_ALL=C pactl -f json list sinks
[{"name": "bluez_output.58_18_62_38_72_FA.1", "description": "WH-1000XM5",
  "monitor_source": "bluez_output.58_18_62_38_72_FA.1.monitor", …}, …]
```

pactl older than 16 has no `-f json`; the descriptions then come from `pactl list sources` (`Description: Monitor of <device>`, prefix dropped). A monitor without a description keeps its name (`<name> (Monitor)`). pactl runs with `LC_ALL=C` because it translates its field names. If `pactl` is missing or fails, only "System audio (default)" is offered; a missing `parec` is reported when recording starts. The monitor source ID is passed to `parec -d <id>`.

### Microphones

`GET /audio/capture/inputs` lists the input sources — every source that is not a monitor (`monitor_source` empty and the name not ending in `.monitor`), by its description, alphabetically:

```
$ LC_ALL=C pactl -f json list sources
[{"name": "alsa_input.usb-…Maono….analog-stereo", "description": "Maono Dynamic Microphone Analog Stereo",
  "monitor_source": "", …}, …]
```

pactl older than 16 falls back to the text list (`Monitor of Sink: n/a` marks an input); an input without a description keeps its name without `alsa_input.`. Without `pactl` the list is empty and only the default microphone is offered. The default microphone records `@DEFAULT_SOURCE@`; a chosen one that is no longer listed fails the start with `The selected microphone is not available: <id>. …`, as for system audio. The microphone is recorded mono, 48 kHz.

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

System audio only:

```bash
ffmpeg -y -i <system.wav> -af "<level filter>" <final.wav>
```

Mic + system:

```bash
ffmpeg -y \
  -i <system.wav> -i <mic.wav> \
  -filter_complex "[0:a]<level filter>[sys];[1:a]<level filter>,aformat=channel_layouts=stereo,adelay=delays=<ms>:all=1[mic];[mic][sys]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=disabled" \
  <merged.wav>
```

`normalize=0` sums the tracks instead of dividing each by the number of inputs; `alimiter` keeps the sum from clipping. The result is the same WAV as before (16-bit PCM).

**Lining the tracks up.** The two tracks do not start or stop together: each has its own capture process, started one after the other (the microphone first), and on Stop the microphone stops first. The service knows when each track started (`started_at`, from the same clock). The mix:

- shifts the track that started later by the difference (`adelay`, after levelling, so the silence put in front of a track takes no part in it): the same moment lines up on both tracks;
- ends with the microphone (`duration=first`, the microphone is the first input): the recording ends where its first track stopped, and the moment of system audio captured after it is dropped;
- upmixes a mono microphone to stereo first: `amix` takes its channel layout from its first input and would otherwise turn the system audio mono.

When the start times are more than 30 s (`_MAX_START_GAP_SEC`) apart — a clock jump, not a real offset — both tracks start at 0 and a warning is logged. The shift is as exact as the two start times: well under a tenth of a second, the time between reading the clock and the first sample on each side. On macOS ScreenCaptureKit hands over audio as it comes; the alignment holds only as long as its track has no gaps.

If the levelling run fails (ffmpeg error or ffmpeg not found), a warning is logged and the recording is stored without levelling: the system-only file is moved as captured, the mix is retried with plain `amix=inputs=2:duration=first`, with the same shift. Only a failure of that plain mix fails the stop.

Microphone-only recordings and imported files are not levelled. The microphone is recorded as the device gives it, without the echo cancellation, noise suppression and automatic gain control a browser would add.

---

## Source files

| File | Description |
|---|---|
| `app/services/audio_capture_service.py` | Python service — platform drivers, job management, loudness levelling and ffmpeg merge |
| `app/services/live_recording_service.py` | The live recording from start to the queue ([Live Recording Service](./LiveRecordingService.md)) |
| `app/api/routers/audio_capture.py` | FastAPI router — `/audio/capture/*` and `/audio/recording/*` endpoints |
| `app/api/dependencies.py` | `get_audio_capture_service()` singleton |
| `native/macos/sonorus-capture/main.swift` | Swift binary — ScreenCaptureKit capture |
| `native/windows/sonorus-capture/main.cpp` | C++ helper — WASAPI loopback capture (Windows) |
| `scripts/build-capture-win.js` | Builds `sonorus-capture.exe` (MSVC or mingw-w64) |
| `electron/backend.js` | Sets `SONORUS_CAPTURE_BIN` env var so the server finds the helper (macOS, Windows) |
| `build/entitlements.mac.plist` | `com.apple.security.screen-capture` and `com.apple.security.device.audio-input` entitlements for signed builds |

:::note[Why stderr is not a pipe]
The capture process runs for the whole recording. An unread `stderr=PIPE` fills its 64 KB buffer once the process writes enough diagnostics; the process then blocks on `write()`, stops capturing, and never exits on SIGINT — the stop would hang forever. stderr is therefore redirected to a log file.
:::
