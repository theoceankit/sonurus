---
sidebar_position: 3
---

# Live Recording

How live recording works: sources, capture per platform, and the files involved. The renderer side of the flow (titlebar button, `_liveSession`, stop cases) is in [Electron UI → Live recording lifecycle](./overview.md#live-recording-lifecycle).

## Overview

The user clicks **+** in the sidebar, chooses audio sources in the New Recording modal, and starts recording. Recording runs **in the background** — the app remains fully navigable. A **Record button** with a live timer appears in the titlebar. Clicking it stops the recording and adds it to the transcription queue.

**Architecture:** mic capture stays in the renderer (WebM via `MediaRecorder`); system audio capture goes through the Python `AudioCaptureService` backend. On every OS the system track is loudness-levelled and the two tracks are merged server-side with `ffmpeg` (see [AudioCaptureService](../../services/AudioCaptureService.md#loudness-levelling-and-mic-merge)).

---

## Architecture

### Mic recording (all platforms)

Handled entirely in the renderer:

1. `getUserMedia({ audio: true, deviceId: micDeviceId })` → `MediaRecorder` → WebM chunks
2. On stop: blob → `POST /audio/recordings` (raw body, `Content-Type: audio/webm`) → the backend stores it as `recordings/sonorus-rec-<uuid>.webm` and returns the path
3. The path is queued with `POST /queue/jobs` as `audio_path`

### System audio (all platforms)

Handled by the Python `AudioCaptureService` backend. The renderer calls HTTP — zero platform detection in JS.

| Platform | Backend tool | Notes |
|---|---|---|
| macOS | `sonorus-capture` Swift binary (ScreenCaptureKit) | Built with `npm run build:capture`; requires Screen Recording permission |
| Linux | `parec -d <monitor_source>` (PulseAudio / PipeWire) | "System audio (default)" first, then each output device by its name (`pactl -f json list sinks`); without `pactl` only the default; needs `pulseaudio-utils` (`libpulse` on Arch Linux) |
| Windows | `sonorus-capture.exe` (C++, WASAPI loopback) | Built with `npm run build:capture:win`; "System audio (default)" plus every active output device; writes silence while nothing plays |

**Flow:**

```
POST /audio/capture/start   → starts backend process, returns job_id
                              (400 with the reason if capture cannot run — shown as a toast, recording does not start)
[user records...]
POST /audio/capture/stop/{job_id}  { mic_path: "..." }
  → stops the capture process (SIGINT; Windows: "stop" on stdin)
  → levels each track (ffmpeg dynaudnorm), mixes with mic (amix, no division, limiter)
  → returns { file_path: merged.wav }
POST /queue/jobs  { audio_path: merged_path }
```

### Source enumeration

`GET /audio/capture/sources` returns platform sources on every OS. The New Recording modal and the Settings Audio section show this list; virtual inputs such as Stereo Mix or VB-Cable are not offered as system audio (any output device can be chosen directly).

---

## Key files

| File | Role |
|---|---|
| `app/services/audio_capture_service.py` | Platform drivers, ffmpeg merge |
| `app/api/routers/audio_capture.py` | `/audio/capture/*` endpoints, `POST /audio/recordings` (upload of a renderer recording) |
| `native/macos/sonorus-capture/main.swift` | Swift SCK binary — build with `npm run build:capture` (requires Xcode Command Line Tools: `xcode-select --install`) |
| `native/windows/sonorus-capture/main.cpp` | C++ WASAPI loopback helper — build with `npm run build:capture:win` (MSVC Build Tools on Windows, or mingw-w64) |
| `electron/renderer/app.js` | `_startLiveRecording()`, `_stopLiveRecording()`, `_liveSession` — background recording state |
| `electron/renderer/views/new-recording-modal.js` | Source picker modal, fetches backend sources |
| `electron/renderer/views/settings-view.js` | Audio device settings section |
| `electron/main.js` | Media permission handler, `SONORUS_CAPTURE_BIN` env |
| `electron/preload.js` | Exposes `getPlatform` via `contextBridge` |

---

## Notes

### macOS SCK fix

`CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer` fails on SCK buffers with `kCMSampleBufferError_BufferHasNoSampleSizes` (-12737) because SCK buffers lack per-sample size metadata. The correct API is `CMSampleBufferCopyPCMDataIntoAudioBufferList`.

### Electron media permissions

`session.defaultSession.setPermissionRequestHandler` in `app.whenReady()` allows the `media` permission — without it `getUserMedia` is blocked by default.

### Screen Recording permission (macOS)

Must be granted once in System Settings → Privacy & Security → Screen Recording for the terminal or app that launches the server. The entitlement `com.apple.security.screen-capture` is declared in `build/entitlements.mac.plist` for signed distribution builds.
