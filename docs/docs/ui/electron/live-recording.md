---
sidebar_position: 3
---

# Live Recording

How live recording works: sources, capture per platform, the window's side of the flow, and the files involved.

## Overview

The user clicks **+** in the titlebar, chooses audio sources in the New recording dialog, and starts recording. Recording runs **in the background** — the app remains fully navigable. A Recording row with a live timer appears in the sidebar (a pill in the titlebar while the sidebar is hidden). Its Stop ends the recording and adds it to the transcription queue.

**Architecture:** the backend records both tracks — the microphone and system audio, one capture process per track — and owns the recording from start to the queue ([Live Recording Service](../../services/LiveRecordingService.md)). The window starts it, shows it from the queue snapshot and stops it; nothing of it lives in the window, so it goes on when the window is closed to the tray, and a new window shows it as live and can stop it. Quitting Sonorus while it records asks first and stops it, saved and queued, before the app quits ([Tray and quitting](overview.md#tray-and-quitting)). On every OS the system track is loudness-levelled and the two tracks are merged with `ffmpeg` (see [AudioCaptureService](../../services/AudioCaptureService.md#loudness-levelling-and-mic-merge)).

---

## Architecture

### Capture per platform

| Platform | Microphone | System audio | Notes |
|---|---|---|---|
| macOS | `sonorus-capture --input <uniqueID\|default>` (AVCaptureSession) | `sonorus-capture` (ScreenCaptureKit) | Built with `npm run build:capture`; microphone access and Screen Recording permission, asked for the app that started the backend |
| Linux | `parec -d <input source>`, mono | `parec -d <monitor_source>` (PulseAudio / PipeWire) | Inputs and outputs by name from `pactl`; without `pactl` only the defaults; needs `pulseaudio-utils` (`libpulse` on Arch Linux) |
| Windows | `sonorus-capture.exe --input --device <id\|default>` (WASAPI) | `sonorus-capture.exe --device <id\|default>` (WASAPI loopback) | Built with `npm run build:capture:win`; writes silence while nothing plays; a microphone switched off for desktop apps fails the start |

### Source enumeration

`GET /audio/capture/sources` returns the system audio sources and `GET /audio/capture/inputs` the microphones, by name (the default microphone is not listed: it is `null`). New recording and Settings → Audio devices show these lists; virtual inputs such as Stereo Mix or VB-Cable are not offered as system audio (any output device can be chosen directly). The window asks for no media permission: Electron refuses every permission request of the page (`setPermissionRequestHandler` in `electron/main.js`).

**Flow:**

```
POST /audio/recording/start  { mic, mic_device, system, system_source, title, whisper_model, language }
  → models checked (400 with a code if one is missing), queue paused, each track started
  → 400 with the reason if a track cannot run — shown as a toast, nothing records
  → the live recording: { phase: "live", title, started_at, sources }, also in the queue snapshot
[user records… the window may be closed and opened again]
POST /audio/recording/stop
  → answers at once: phase "stopping"
  → the tracks stop, are levelled and mixed into recordings/sonorus-rec-<id>.wav, queued with the
    title, model and language of the start; the queue is let go last
  → WS /ws/queue: the snapshot with recording null and the new job, or recording_failed
A capture process that ends by itself (a microphone unplugged) → the same stop + recording_source_lost
```

---

## In the window

The backend records and writes every file; the window drives and shows the recording.

- **Starting.** New recording ([Home](./home.md#new-recording-dialog)) picks the sources and devices and calls `start()` of `RecordingProvider`, which sits in `App` above the screens, so a recording shows while the user moves between them. It sends `POST /audio/recording/start` and shows Starting until the backend answers. A refusal is a toast "Could not start recording: …" (on macOS a Screen Recording refusal says where to allow it, `captureStartError()`).
- **Recording.** The state comes from the queue snapshot (`recording`), which `useQueueEventsSync` keeps up from `WS /ws/queue`: a window opened mid-recording shows it from its first snapshot. The sidebar shows a Recording section above the queue with one row (`LiveRecordingRow`): a red dot the size of the new-recording dot, breathing, the title and the time, Starting or Stopping in its place while the backend gets ready or finishes. Stop comes in under the pointer or the focus. With the sidebar hidden, a pill in the title bar (`RecordingPill`) shows the same before the Speakers button; its arrow opens a menu with Stop recording. The time counts from `started_at` of the backend, so a late timer adds nothing and a new window shows the right time.
- **Stopping.** Stop sends `POST /audio/recording/stop` and shows Stopping; the recording ends when the snapshot no longer has it, with the new job at the end of the queue. A refused Stop is a toast "Recording error: …" and the recording goes on. A `recording_failed` event is a toast "Recording error: …"; `recording_source_lost` says "The microphone was disconnected. The recording was stopped and saved." (or "System audio was lost. …") — the recording is in the queue (`queueEventToast()` in `ui/src/screens/Queue/queue-toasts.ts`).
- **Elsewhere.** While a recording runs New recording says so and only offers Import files, and Delete all data in Settings is off.

---

## Key files

| File | Role |
|---|---|
| `app/services/live_recording_service.py` | The recording from start to the queue |
| `app/services/audio_capture_service.py` | Platform drivers, ffmpeg merge |
| `app/api/routers/audio_capture.py` | `/audio/capture/*` and `/audio/recording/*` endpoints |
| `native/macos/sonorus-capture/main.swift` | Swift helper — ScreenCaptureKit and the microphone — build with `npm run build:capture` (requires Xcode Command Line Tools: `xcode-select --install`) |
| `native/windows/sonorus-capture/main.cpp` | C++ WASAPI helper, loopback and input — build with `npm run build:capture:win` (MSVC Build Tools on Windows, or mingw-w64) |
| `ui/src/recording/` | `RecordingProvider.tsx` (start, stop, the state from the snapshot), `useRecordingSetup.ts` (the dialog's sources and devices), `sources.ts`, `LiveRecording.tsx` (the sidebar section and the title bar pill) |
| `ui/src/components/SourceToggle/`, `LiveRecordingRow/`, `RecordingPill/` | A source of the dialog, the recording's row, its pill |
| `ui/src/screens/Settings/AudioSection.tsx` | Settings → Audio devices |
| `electron/main.js` | Refuses the page's permission requests; `SONORUS_CAPTURE_BIN` env |
| `electron/preload.js` | Exposes `getPlatform` via `contextBridge` |

---

## Notes

### macOS SCK fix

`CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer` fails on SCK buffers with `kCMSampleBufferError_BufferHasNoSampleSizes` (-12737) because SCK buffers lack per-sample size metadata. The correct API is `CMSampleBufferCopyPCMDataIntoAudioBufferList`.

### Electron permissions

`session.defaultSession.setPermissionRequestHandler` in `app.whenReady()` refuses every permission request of the page, `media` included: the backend records, and without a handler Electron would grant them all.

### Screen Recording permission (macOS)

Must be granted once in System Settings → Privacy & Security → Screen Recording for the terminal or app that launches the server, and the microphone under Microphone (the helper asks on the first microphone recording). The entitlements `com.apple.security.screen-capture` and `com.apple.security.device.audio-input` are declared in `build/entitlements.mac.plist` for signed distribution builds.
