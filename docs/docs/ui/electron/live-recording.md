---
sidebar_position: 3
---

# Live Recording

How live recording works: sources, capture per platform, the window's side of the flow, and the files involved.

## Overview

The user clicks **+** in the titlebar, chooses audio sources in the New recording dialog, and starts recording. Recording runs **in the background** — the app remains fully navigable. A Recording row with a live timer appears in the sidebar (a pill in the titlebar while the sidebar is hidden). Its Stop ends the recording and adds it to the transcription queue.

**Architecture:** the backend records both tracks — the microphone and system audio, one capture process per track — and owns the recording from start to the queue ([Live Recording Service](../../services/LiveRecordingService.md)). The window starts it, shows it from the queue snapshot and stops it; nothing of it lives in the window, so it goes on when the window is closed to the tray, and a new window shows it as live and can stop it. Quitting Sonorus while it records asks first and stops it, saved and queued, before the app quits ([Tray and quitting](overview.md#tray-and-quitting)). On every OS each track is brought to the same loudness with one constant gain and the two tracks are merged with `ffmpeg` (see [AudioCaptureService](../../services/AudioCaptureService.md#loudness-levelling-and-mic-merge)).

---

## Architecture

### Capture per platform

| Platform | Microphone | System audio | Notes |
|---|---|---|---|
| macOS 14.2+ | `sonorus-capture --input <uniqueID\|default>` (AVCaptureSession) | `sonorus-capture` (Core Audio tap of every process) | Built with `npm run build:capture`; Microphone and System Audio Recording permissions, asked for the app that started the backend; a refused system audio permission gives silence, not an error |
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
  → WS /ws/queue: the snapshot with recording null and the new job, or recording_failed;
    recording_system_silent before the snapshot when a macOS system track held zeros only
A capture process that ends by itself (a microphone unplugged) → the same stop + recording_source_lost
```

---

## In the window

The backend records and writes every file; the window drives and shows the recording.

- **Starting.** New recording ([Home](./home.md#new-recording-dialog)) picks the sources and devices and calls `start()` of `RecordingProvider`, which sits in `App` above the screens, so a recording shows while the user moves between them. It sends `POST /audio/recording/start` and shows Starting until the backend answers. A refusal is a toast "Could not start recording: …" (on macOS a start the system refused says where to allow system audio recording, `captureStartError()`).
- **Recording.** The state comes from the queue snapshot (`recording`), which `useQueueEventsSync` keeps up from `WS /ws/queue`: a window opened mid-recording shows it from its first snapshot. The sidebar shows a Recording section above the queue with one row (`LiveRecordingRow`): a red dot the size of the new-recording dot, breathing, the title and the time, Starting or Stopping in its place while the backend gets ready or finishes. Stop comes in under the pointer or the focus. With the sidebar hidden, a pill in the title bar (`RecordingPill`) shows the same before the Speakers button; its arrow opens a menu with Stop recording. The time counts from `started_at` of the backend, so a late timer adds nothing and a new window shows the right time.
- **Stopping.** Stop sends `POST /audio/recording/stop` and shows Stopping; the recording ends when the snapshot no longer has it, with the new job at the end of the queue. A refused Stop is a toast "Recording error: …" and the recording goes on. A `recording_failed` event is a toast "Recording error: …"; `recording_source_lost` says "The microphone was disconnected. The recording was stopped and saved." (or "System audio was lost. …") — the recording is in the queue (`queueEventToast()` in `ui/src/screens/Queue/queue-toasts.ts`). `recording_system_silent` is a hint, not an error, shown for 10 s: "No system audio was heard in "…". If something played, allow Sonorus in System Settings → Privacy & Security → Screen & System Audio Recording." The recording is in the queue all the same.
- **Elsewhere.** While a recording runs New recording says so and only offers Import files, and Delete all data in Settings is off.

---

## Calls starting and ending

Sonorus can suggest a recording when a call seems to start, and its end when the call seems to end. The backend tells; the Electron main process decides, by Settings → Notifications ([Settings](settings.md#notifications)), so it works with the window closed to the tray. Nothing records without the user.

- **Signals.** [MicActivityService](../../services/MicActivityService.md) sends `mic_app_active` when another app has held a microphone for 15 s with no recording running, and `call_ended` (`mic_released`) when, during a recording, every other app has let go of it for 15 s. [LiveRecordingService](../../services/LiveRecordingService.md) sends `call_ended` (`silence`) when no track had sound for 5 minutes. All go over `WS /ws/queue`, which the main process listens to as the window does (`electron/backend-events.js`, reconnected after a backend restart); the window ignores them.
- **What happens** (`promptFor()` in `electron/recording-prompts.js`). Nothing with Show notifications off. A start, when suggestions are on, no recording runs and the app counts (any app, or one of the selected): a notification "Looks like a call started in Discord" (without the name where the system does not give it), "Click to start recording." An end, while the recording is live: Suggest stopping — "Looks like the call ended", "Click to stop recording." (after silence: "Nothing was heard for 5 minutes. Click to stop recording."); Stop recording automatically — `POST /audio/recording/stop`, which answers before the recording is saved, so the notice waits for how it ended over `WS /ws/queue`: a snapshot without the recording gives "Recording stopped and saved" with the title, a `recording_failed` event "Could not save the recording" with the title and the error, and no word in 60 s (the backend went down) "Recording stopped", "Standup. Open Sonorus to see whether it was saved."; Do nothing. Every app of a `mic_app_active` is remembered in `micApps` of `app-state.json`, for the list of selected apps.
- **A click** brings the window to the front, making it again if it was closed to the tray, and leaves an intent for it: the page takes it when it loads (`takeWindowIntent()`), and a page already open is told one waits (`onWindowIntent`). New recording opens with the title named after the app ("5 Nov 14:30 Discord call"); Stop recording? asks "Standup" is still recording. Stop it and add it to the queue? (with the title of the recording) with Keep recording and Stop recording (`StopRecordingDialog`). The question waits up to 5 s for a page that has not yet heard of the recording, and goes by itself when the recording ends. The notification shows also when the window is open and in front.
- **Per OS**, below.

| OS | Start of a call | End by the microphone | End by silence | Clicks |
|---|---|---|---|---|
| Linux | With `pactl`, named | With `pactl` | Yes | On the notification as a whole, no buttons; a notification server that does not send clicks shows it but opens nothing |
| Windows | Named (`sonorus-capture.exe --watch-mic`) | Yes | Yes | On the notification; needs the AppUserModelID, which the main process sets: `build.appId` in the installed app, the exe path in a dev run (`appUserModelId()`) |
| macOS 14.2 and newer | Named (`sonorus-capture --watch-mic`) | Yes | Yes | On the notification |
| macOS before 14.2 | Without a name: the system only says a microphone is in use | No | Yes | On the notification |

---

## Key files

| File | Role |
|---|---|
| `app/services/live_recording_service.py` | The recording from start to the queue |
| `app/services/audio_capture_service.py` | Platform drivers, ffmpeg merge |
| `app/api/routers/audio_capture.py` | `/audio/capture/*` and `/audio/recording/*` endpoints |
| `native/macos/sonorus-capture/main.swift` | Swift helper — the Core Audio tap, the microphone and the microphone watch — build with `npm run build:capture` (requires Xcode Command Line Tools: `xcode-select --install`) |
| `native/windows/sonorus-capture/main.cpp` | C++ WASAPI helper, loopback and input, and the microphone watch (`--watch-mic`) — build with `npm run build:capture:win` (MSVC Build Tools on Windows, or mingw-w64) |
| `ui/src/recording/` | `RecordingProvider.tsx` (start, stop, the state from the snapshot), `useRecordingSetup.ts` (the dialog's sources and devices), `sources.ts`, `LiveRecording.tsx` (the sidebar section and the title bar pill), `StopRecordingDialog.tsx` (the question of a call that ended) |
| `app/services/mic_activity_service.py`, `app/services/track_silence.py` | Which other apps hold a microphone; the silence of the tracks |
| `electron/backend-events.js`, `electron/recording-prompts.js` | The queue events in the main process; notifications of a call, the automatic stop |
| `ui/src/platform/window-intent.ts`, `ui/src/screens/Settings/NotificationsSection.tsx` | The dialog a notification opens; Settings → Notifications |
| `ui/src/components/SourceToggle/`, `LiveRecordingRow/`, `RecordingPill/` | A source of the dialog, the recording's row, its pill |
| `ui/src/screens/Settings/AudioSection.tsx` | Settings → Audio devices |
| `electron/main.js` | Refuses the page's permission requests; `SONORUS_CAPTURE_BIN` env |
| `electron/preload.js` | Exposes `getPlatform` via `contextBridge` |

---

## Notes

### macOS sample buffers

The microphone's sample buffers are copied with `CMSampleBufferCopyPCMDataIntoAudioBufferList`: `CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer` refuses buffers without per-sample sizes (`kCMSampleBufferError_BufferHasNoSampleSizes`, -12737).

### Electron permissions

`session.defaultSession.setPermissionRequestHandler` in `app.whenReady()` refuses every permission request of the page, `media` included: the backend records, and without a handler Electron would grant them all.

### System audio permission (macOS)

System audio is a Core Audio process tap (`AudioHardwareCreateProcessTap`, macOS 14.2 and newer), recorded under the System Audio Recording permission of the app that started the backend: Sonorus in the installed app, the terminal under `npm start` or a backend started by hand. The system asks once, when the first tap starts, and only if that app's `Info.plist` says why (`NSAudioCaptureUsageDescription` in `build.mac.extendInfo`); without the key, or when the user refused, the tap runs and gives zeros, with no error. So the backend cannot tell a refusal from nothing playing: when the system track of a saved recording held zeros only (`AudioCaptureService.only_silence()`), a `recording_system_silent` event says where to allow it. The permission is listed under System Settings → Privacy & Security → Screen & System Audio Recording (System Audio Recording Only) and reset with `tccutil reset AudioCapture com.sonorus.app`. Screen Recording is not used.

The microphone is asked for on the first microphone recording and listed under Microphone. `com.apple.security.device.audio-input` in `build/entitlements.mac.plist` lets the hardened runtime use it; the tap needs no entitlement.
