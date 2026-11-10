---
sidebar_position: 3
---

# Live Recording

How live recording works: sources, capture per platform, the window's side of the flow, and the files involved.

## Overview

The user clicks **+** in the titlebar, chooses audio sources in the New recording dialog, and starts recording. Recording runs **in the background** — the app remains fully navigable. A Recording row with a live timer appears in the sidebar (a pill in the titlebar while the sidebar is hidden). Its Stop ends the recording and adds it to the transcription queue.

**Architecture:** mic capture stays in the window (WebM via `MediaRecorder`); system audio capture goes through the Python `AudioCaptureService` backend. On every OS the system track is loudness-levelled and the two tracks are merged server-side with `ffmpeg` (see [AudioCaptureService](../../services/AudioCaptureService.md#loudness-levelling-and-mic-merge)).

---

## Architecture

### Mic recording (all platforms)

Handled entirely in the window:

1. `getUserMedia({ audio: true, deviceId: micDeviceId })` → `MediaRecorder` → WebM chunks
2. On stop: blob → `POST /audio/recordings` (raw body, `Content-Type: audio/webm`) → the backend stores it as `recordings/sonorus-rec-<uuid>.webm` and returns the path
3. The path is queued with `POST /queue/jobs` as `audio_path`

### System audio (all platforms)

Handled by the Python `AudioCaptureService` backend. The window calls HTTP — zero platform detection in JS.

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

`GET /audio/capture/sources` returns platform sources on every OS. The menu of the System audio button in New recording and Settings → Audio devices show this list; virtual inputs such as Stereo Mix or VB-Cable are not offered as system audio (any output device can be chosen directly).

---

## In the window

The backend writes every file; the window records the microphone and drives the flow.

- **Starting.** New recording ([Home](./home.md#new-recording-dialog)) picks the sources and devices and calls `start()` of `RecordingProvider`, which sits in `App` above the screens, so a recording goes on while the user moves between them. `startRecording()` in `ui/src/recording/session.ts` sends `POST /queue/recording/start`, opens the microphone (`getUserMedia`, an `AudioContext` into `MediaRecorder`, WebM with a chunk a second) and asks the backend to capture system audio. A refusal is a toast "Could not start recording: …"; everything it took is let go, and the queue too.
- **Recording.** The sidebar shows a Recording section above the queue with one row (`LiveRecordingRow`): a red dot the size of the new-recording dot, breathing, the title and the time, Starting or Stopping in its place while the backend and the microphone get ready or finish. Stop comes in under the pointer or the focus. With the sidebar hidden, a pill in the title bar (`RecordingPill`) shows the same before the Speakers button; its arrow opens a menu with Stop recording. The time counts from the start, so a late timer adds nothing.
- **Stopping.** With system audio, the microphone's recording (if any) is uploaded and `POST /audio/capture/stop/{job_id}` mixes it in; the microphone alone is uploaded as it is. Then `POST /queue/jobs` with the title, the model and the language of the dialog, and `POST /queue/recording/stop` last whatever happened. A failure is a toast "Recording error: …".
- **Elsewhere.** While a recording runs New recording says so and only offers Import files, and Delete all data in Settings is off.

The browser's audio is passed into `startRecording()` (`browserDeps()` in the app), so tests run every start and stop path on the fixtures without a microphone.

---

## Key files

| File | Role |
|---|---|
| `app/services/audio_capture_service.py` | Platform drivers, ffmpeg merge |
| `app/api/routers/audio_capture.py` | `/audio/capture/*` endpoints, `POST /audio/recordings` (upload of the window's microphone recording) |
| `native/macos/sonorus-capture/main.swift` | Swift SCK binary — build with `npm run build:capture` (requires Xcode Command Line Tools: `xcode-select --install`) |
| `native/windows/sonorus-capture/main.cpp` | C++ WASAPI loopback helper — build with `npm run build:capture:win` (MSVC Build Tools on Windows, or mingw-w64) |
| `ui/src/recording/` | `session.ts` (start and stop), `RecordingProvider.tsx`, `useRecordingSetup.ts` (the dialog's sources and devices), `sources.ts`, `devices.ts`, `LiveRecording.tsx` (the sidebar section and the title bar pill) |
| `ui/src/components/SourceToggle/`, `LiveRecordingRow/`, `RecordingPill/` | A source of the dialog, the recording's row, its pill |
| `ui/src/screens/Settings/AudioSection.tsx` | Settings → Audio devices |
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
