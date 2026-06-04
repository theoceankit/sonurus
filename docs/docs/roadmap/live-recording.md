---
sidebar_position: 4
---

# Live Recording

Implementation notes for the live meeting recording feature.

## Overview

The user selects **Live recording** on the main screen, optionally chooses audio sources, records, reviews, and submits to the existing transcription pipeline.

**Architecture:** mic capture stays in the renderer (WebM via `MediaRecorder`); system audio capture goes through the Python `AudioCaptureService` backend. The two tracks are merged server-side with `ffmpeg amix`.

---

## Implementation status

| Phase | Status |
|---|---|
| Phase 1 — Electron plumbing (permissions, IPC `save-recording`) | ✅ Done |
| Phase 2 — Real audio device enumeration in Settings | ✅ Done |
| Phase 3 — Live recording view (ready / recording / review states) | ✅ Done |
| Phase 4 — Wire into existing UI | ✅ Done |
| Phase 5 — System audio via backend (`AudioCaptureService`) | ✅ Done |

354 tests passing (11 audio capture tests + 343 existing).

---

## Architecture

### Mic recording (all platforms)

Handled entirely in the renderer:

1. `getUserMedia({ audio: true, deviceId: micDeviceId })` → `MediaRecorder` → WebM chunks
2. On stop: blob → `blob.arrayBuffer()` → IPC `save-recording(buffer, 'webm')` → temp path
3. The temp path is sent to `POST /transcribe` as `audio_path`

### System audio (macOS + Linux)

Handled by the Python `AudioCaptureService` backend. The renderer calls HTTP — zero platform detection in JS.

| Platform | Backend tool | Notes |
|---|---|---|
| macOS | `sonorus-capture` Swift binary (ScreenCaptureKit) | Built with `npm run build:capture`; requires Screen Recording permission |
| Linux | `ffmpeg -f pulse -i <monitor_source>` | Monitor sources enumerated via `pactl list short sources` |
| Windows | `setDisplayMediaRequestHandler(audio: 'loopback')` | WASAPI loopback in renderer; no backend needed |

**Flow (macOS / Linux):**

```
POST /audio/capture/start   → starts backend process, returns job_id
[user records...]
POST /audio/capture/stop/{job_id}  { mic_path: "..." }
  → sends SIGINT to capture process
  → merges with mic via ffmpeg amix=inputs=2:duration=shortest
  → returns merged .wav path
POST /transcribe  { audio_path: merged_path }
```

### Source enumeration

`GET /audio/capture/sources` returns platform sources. The New Recording modal fetches this on macOS and Linux; Settings Audio section shows the same list. On Windows the renderer uses `enumerateDevices()` directly.

---

## Key files

| File | Role |
|---|---|
| `app/services/audio_capture_service.py` | Platform dispatch, ffmpeg merge |
| `app/api/routers/audio_capture.py` | `/audio/capture/*` endpoints |
| `native/macos/sonorus-capture/main.swift` | Swift SCK binary |
| `electron/renderer/views/live-recording-view.js` | Renderer: ready/recording/review states, VU meters |
| `electron/renderer/views/new-recording-modal.js` | Source picker modal, fetches backend sources |
| `electron/renderer/views/settings-view.js` | Audio device settings section |
| `electron/main.js` | `save-recording` IPC, media permission handler, `SONORUS_CAPTURE_BIN` env |
| `electron/preload.js` | Exposes `saveRecording`, `getPlatform` via `contextBridge` |

---

## Notes

### macOS SCK fix

`CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer` fails on SCK buffers with `kCMSampleBufferError_BufferHasNoSampleSizes` (-12737) because SCK buffers lack per-sample size metadata. The correct API is `CMSampleBufferCopyPCMDataIntoAudioBufferList`.

### Electron media permissions

`session.defaultSession.setPermissionRequestHandler` in `app.whenReady()` allows the `media` permission — without it `getUserMedia` is blocked by default.

### Screen Recording permission (macOS)

Must be granted once in System Settings → Privacy & Security → Screen Recording for the terminal or app that launches the server. The entitlement `com.apple.security.screen-capture` is declared in `build/entitlements.mac.plist` for signed distribution builds.
