---
sidebar_position: 4
---

# Live Recording

Implementation notes for the live meeting recording feature.

## Overview

The user clicks **+** in the sidebar, chooses audio sources in the New Recording modal, and starts recording. Recording runs **in the background** — the app remains fully navigable. A **Record button** with a live timer appears in the titlebar. Clicking it stops the recording and immediately starts transcription.

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
| Phase 6 — Background recording UX (titlebar timer, no dedicated view) | ✅ Done |

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
  → returns { file_path: merged.wav }
POST /transcribe  { audio_path: merged_path }
```

**Flow (Windows):**

```
navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width:1, height:1 } })
  → intercepted by Electron setDisplayMediaRequestHandler
  → callback({ video: sources[0], audio: 'loopback' })   ← WASAPI loopback, no picker
  → video tracks discarded; audio track mixed into AudioContext
MediaRecorder (WebM) → blob → IPC save-recording → temp .webm
POST /transcribe  { audio_path: temp.webm }
```

No backend capture process is started on Windows; `POST /audio/capture/*` is not called.

### Source enumeration

`GET /audio/capture/sources` returns platform sources. The New Recording modal fetches this on macOS and Linux; Settings Audio section shows the same list. On Windows the renderer uses `enumerateDevices()` directly.

---

## Key files

| File | Role |
|---|---|
| `app/services/audio_capture_service.py` | Platform dispatch, ffmpeg merge |
| `app/api/routers/audio_capture.py` | `/audio/capture/*` endpoints |
| `native/macos/sonorus-capture/main.swift` | Swift SCK binary — build with `npm run build:capture` (requires Xcode Command Line Tools: `xcode-select --install`) |
| `electron/renderer/app.js` | `_startLiveRecording()`, `_stopLiveRecording()`, `_liveSession` — background recording state |
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
