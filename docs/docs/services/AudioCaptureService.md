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

Running capture in a Python subprocess sidesteps these restrictions and keeps all platform logic in one place.

---

## Platform dispatch

| Platform | Tool | How it works |
|---|---|---|
| macOS | `sonorus-capture` (Swift binary, ScreenCaptureKit) | Spawned as a subprocess; writes WAV to a temp file; stopped with SIGINT |
| Linux | `ffmpeg -f pulse -i <monitor_source>` | PulseAudio monitor source recorded directly; sources enumerated via `pactl list short sources` |
| Windows | `setDisplayMediaRequestHandler(audio: 'loopback')` in renderer | WASAPI loopback handled in Electron main process; no backend subprocess needed |

---

## Job lifecycle

```
POST /audio/capture/start
  → AudioCaptureService.start_capture(source_id)
  → spawns platform process (stderr=PIPE)
  → stores { process, output_path } under job_id
  → returns job_id

[user records...]

POST /audio/capture/stop/{job_id}  { mic_path?: "..." }
  → sends SIGINT to capture process
  → process.wait()
  → reads and logs stderr (warnings to logging.warning)
  → logs output file size
  → if mic_path provided: ffmpeg amix merge → merged WAV
  → returns final WAV path

POST /transcribe  { audio_path: "<returned path>" }
```

Mic recording (WebM via `MediaRecorder`) is saved to a temp file by the Electron main process via IPC `save-recording`. The path is passed as `mic_path` to `stop_capture`.

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

## Linux: finding monitor sources

`GET /audio/capture/sources` runs `pactl list short sources` and filters for lines containing `"monitor"`:

```
$ pactl list short sources
42  alsa_output.pci-0000_00_1f.3.analog-stereo.monitor  ...
```

The monitor source ID is passed to `ffmpeg -f pulse -i <id>`. If no monitor sources are found, the endpoint returns an empty list and the UI shows a "no sources" message.

---

## Mic + system merge

When both tracks are present, `stop_capture(mic_path=...)` calls:

```bash
ffmpeg -y \
  -i <system.wav> -i <mic.webm> \
  -filter_complex "amix=inputs=2:duration=shortest" \
  <merged.wav>
```

`duration=shortest` ensures the merged file ends when the shorter track ends, avoiding silence padding if the two recordings differ slightly in length.

---

## Source files

| File | Description |
|---|---|
| `app/services/audio_capture_service.py` | Python service — platform dispatch, job management, ffmpeg merge |
| `app/api/routers/audio_capture.py` | FastAPI router — `/audio/capture/*` endpoints |
| `app/api/dependencies.py` | `get_audio_capture_service()` singleton |
| `native/macos/sonorus-capture/main.swift` | Swift binary — ScreenCaptureKit capture |
| `electron/backend.js` | Sets `SONORUS_CAPTURE_BIN` env var so the server finds the binary |
| `build/entitlements.mac.plist` | `com.apple.security.screen-capture` entitlement for signed builds |
