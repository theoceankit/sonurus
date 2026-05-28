---
sidebar_position: 4
---

# Live Recording

Implementation plan for the live meeting recording feature.

## Overview

The user selects **Live recording** on the main screen and records system audio and microphone simultaneously. After stopping, the recording is saved to a temporary file and passed through the existing transcription pipeline.

**No backend changes required.** The recording produces a `.webm` file that is sent to the existing `POST /transcribe` endpoint via its `audio_path` field.

## Current state

- The "Live recording" tile exists in `import-view.js` but is disabled (`comingSoon: true`).
- The "Audio devices" section in `settings-view.js` (`buildAudioSection`) exists but contains hardcoded placeholder dropdowns with no real device enumeration.

## Technical notes

### System audio on Linux

On Linux with PulseAudio/PipeWire, the monitor source (e.g. "Monitor of Built-in Audio Analog Stereo") appears as a regular `audioinput` device in `navigator.mediaDevices.enumerateDevices()`. No `desktopCapturer` or special kernel modules are needed — `getUserMedia` with the monitor device ID captures system audio directly.

### Electron media permissions

Electron blocks `getUserMedia` by default. A `session.defaultSession.setPermissionRequestHandler` in `app.whenReady()` is required to allow the `media` permission.

### Recording format

`MediaRecorder` with `audio/webm;codecs=opus` produces a file WhisperX already handles (`.webm` is in the accepted formats list). The blob is transferred via IPC as an `ArrayBuffer` and written to `os.tmpdir()` by the main process.

### Audio mixing

Two independent `getUserMedia` streams (mic + monitor source) are fed into a shared `AudioContext`. Each stream gets a `GainNode` and a tap on an `AnalyserNode` for the VU meter. The mixed `MediaStreamDestination` stream is passed to `MediaRecorder`.

---

## Implementation status

| Phase | Status |
|---|---|
| Phase 1 — Electron plumbing | ✅ Done |
| Phase 2 — Real audio device enumeration | ✅ Done |
| Phase 3 — Live recording view | ✅ Done |
| Phase 4 — Wire into existing UI | ✅ Done |
| Phase 5 — Verification | ✅ Done (343 tests passing) |

## Known issues

### Editor view title shows audio filename

**Symptom:** the editor view header (centre panel, top of transcript) shows the audio filename (`whisper-rec-<uuid>`) instead of the title entered by the user in the review screen. The sidebar shows the correct title.

**Cause:** `editor-view.js` reads `audio_path` from `GET /transcripts/{id}`, not the `title` field. The `title` column was added to the DB and is used in `list_all()` (sidebar), but `TranscriptResponse` and `editor-view.js` do not yet expose it.

**Fix:** add `title` to `TranscriptResponse`, return it from `GET /transcripts/{id}`, and render it in `editor-view.js`.

---

## Implementation plan

### Phase 1 — Electron plumbing

**Files:** `electron/main.js`, `electron/preload.js`

**`electron/main.js`**
- Add `session.defaultSession.setPermissionRequestHandler` in `app.whenReady()` to allow the `media` permission.
- Add IPC handler `save-recording({ buffer, ext })`: writes `ArrayBuffer` to `os.tmpdir()/whisper-rec-<uuid>.<ext>`, returns the absolute path.
- Extend `DEFAULT_SETTINGS`:
  ```js
  recordingMicDevice: null,    // null = first available mic
  recordingSystemDevice: null, // null = first monitor source
  recordingUseMic: true,
  ```

**`electron/preload.js`**
- Expose `saveRecording: (buffer, ext) => ipcRenderer.invoke('save-recording', { buffer, ext })`.

---

### Phase 2 — Real audio device enumeration in Settings

**Files:** `electron/renderer/views/settings-view.js`, `electron/renderer/app.js`

**`app.js`** — extend `appSettings`:
```js
recordingMicDevice: null,
recordingSystemDevice: null,
recordingUseMic: true,
```

**`settings-view.js`**, rewrite `buildAudioSection(state)`:
- On render: call `getUserMedia({ audio: true })` once to trigger the permission dialog and unlock device labels, then call `enumerateDevices()`.
- Split `audioinput` devices into two groups:
  - Microphones — devices whose label does **not** contain `"monitor"` (case-insensitive).
  - System audio sources — devices whose label **does** contain `"monitor"`.
- Mic dropdown: microphone devices only.
- System audio dropdown: monitor sources + **"None (disabled)"** option.
- Toggle **"Include microphone"** maps to `recordingUseMic`.
- Every change calls `saveSettings({...})`.

---

### Phase 3 — Live recording view

**File:** `electron/renderer/views/live-recording-view.js` (new, ~280 lines)

The view has three internal states:

#### `ready`
- Summary of configured devices (mic name + system source name).
- Attempts `getUserMedia` with the configured devices; shows an inline error if permission is denied or the device is unavailable.
- "Start recording" button.
- "Configure devices in Settings" link shown when no monitor sources are found.

#### `recording`
- Calls `getUserMedia` for mic (if `recordingUseMic`) and for system audio (by `recordingSystemDevice`).
- `AudioContext` mixes both streams: each stream → `GainNode` → `MediaStreamDestination`.
- `AnalyserNode` on each source feeds two VU meter bars updated with `requestAnimationFrame`.
- `MediaRecorder` on the mixed stream, `mimeType: 'audio/webm;codecs=opus'`, `timeslice: 1000`.
- Elapsed time counter (`setInterval`, 1 s), red dot animation.
- **Stop** button.

#### `review`
- `MediaRecorder.stop()` → `ondataavailable` accumulates chunks → `new Blob(chunks)` → `blob.arrayBuffer()` → IPC `saveRecording(buffer, 'webm')` → temp file path.
- Displays "Recording complete · Xm Ys".
- Title `<input>` pre-filled with `Meeting YYYY-MM-DD HH:MM`.
- **Transcribe** → `POST /transcribe` with the temp path → `app.showProgress(jobId, request)`.
- **Discard** → `app.showImport()`.

---

### Phase 4 — Wire into existing UI

**Files:** `electron/renderer/views/import-view.js`, `electron/renderer/app.js`, `electron/renderer/index.html`

**`import-view.js`**
- Remove `comingSoon: true` from the `live` tile definition.
- Add `onclick: () => app.showLiveRecording()` to the tile.

**`app.js`**
- Add `showLiveRecording()` method (mirrors `showImport()`).

**`electron/renderer/index.html`**
- Add `<script src="views/live-recording-view.js"></script>` before `app.js`.

---

### Phase 5 — Verification

- Run all 343 Python tests — no backend changes, no regressions expected.
- Manual end-to-end: record → review → transcribe → editor.
- Edge cases:
  - No monitor source available on the system.
  - `getUserMedia` permission denied.
  - Recording shorter than 1 second.
  - Stopping immediately after starting (empty MediaRecorder chunks).

---

## Files changed

| File | Type | Scope |
|---|---|---|
| `electron/renderer/views/live-recording-view.js` | New | ~280 lines |
| `electron/main.js` | Edit | +20 lines |
| `electron/preload.js` | Edit | +2 lines |
| `electron/renderer/app.js` | Edit | +8 lines |
| `electron/renderer/views/import-view.js` | Edit | +3 lines |
| `electron/renderer/views/settings-view.js` | Edit | ~50 lines (rewrite `buildAudioSection`) |
| `electron/renderer/index.html` | Edit | +1 line |
