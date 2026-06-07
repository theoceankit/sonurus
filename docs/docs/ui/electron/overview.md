---
sidebar_position: 1
---

# Electron UI

Cross-platform desktop interface built with Electron + Vanilla JS. Communicates with the Python FastAPI server over HTTP and WebSocket.

---

## Running in dev mode

```bash
npm start
```

`electron/backend.js` automatically starts the FastAPI server before the window opens. If a server is already listening on port 8000, the spawn is skipped.

To start the backend manually (e.g. for isolated API testing):
```bash
# Do NOT add --reload — watchfiles triggers on .py files in .models/ and kills downloads
.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

---

## Backend lifecycle

`electron/backend.js` manages the server process:

1. `checkHealth()` — polls `GET /health`. If already responding, skips spawn.
2. First-run (packaged only): runs `pip install -r requirements.txt --target $userData/python-packages/`.
3. Spawns `uvicorn` with env: `HF_TOKEN`, `SONORUS_DATA_DIR`, `LOG_FILE`, `PYTHONPATH` (packaged).
4. `waitForReady()` — polls `/health` up to 60s before opening the window.
5. `stopBackend()` — kills the process on `will-quit`.

`SONORUS_TEST_SETUP=1 npm start` forces first-run setup mode in dev.

---

## File structure

```
electron/
  main.js              — BrowserWindow, IPC handlers, backend lifecycle orchestration
  backend.js           — Backend process spawn, health check, first-run pip install
  preload.js           — contextBridge: exposes electronAPI.*
  screenshot-setup.js  — DEV-ONLY screenshot utility (never packaged)
  assets/
    icon.png           — 512×512 source icon
  renderer/
    index.html         — App shell: left sidebar + main panel
    setup.html         — First-run setup screen (shown during pip install)
    utils.js           — API_BASE, WS_BASE, speaker helpers, fmtTime, makeAvatar
    components.js      — makeDropdown (shared UI component)
    data.js            — LANGUAGES (static), MODELS (fallback), ALIGNMENT_MODELS (source of truth)
    app.js             — appSettings, loadSettings/saveSettings, view router, sidebar
    styles/
      base.css         — Design tokens, resets
      layout.css       — Sidebar + main panel layout
      import.css       — Import/recording/progress view styles
      editor.css       — Transcript editor styles
      settings.css     — Settings screen styles
      views.css        — Toasts, misc shared view styles
      modal.css        — Modal overlay styles
    views/
      new-recording-modal.js  — Recording setup modal (source picker, model/language, toggles)
      progress-view.js        — WebSocket transcription progress
      editor-view.js          — Transcript editor entry point
      settings-view.js        — Settings screen
      editor/                 — Editor sub-components
        tooltip.js, speaker-picker.js, segment-row.js,
        speaker-card.js, waveform.js, player-bar.js, right-panel.js
```

---

## IPC bridge

`preload.js` exposes the following via `contextBridge` as `window.electronAPI`:

| Method | Description |
|---|---|
| `openFile()` | Native file-open dialog (audio/video filter) |
| `getFilePath(file)` | Resolve a dropped `File` object to a filesystem path |
| `readSettings()` | Read `settings.json` from `app.getPath('userData')` |
| `writeSettings(data)` | Write `settings.json` to `app.getPath('userData')` |
| `setZoom(factor)` | Call `webContents.setZoomFactor(factor)` |
| `saveRecording(buffer, ext)` | Write a recording buffer to `os.tmpdir()` |
| `writeClipboard(text)` | Write text to the system clipboard |
| `onSetupProgress(callback)` | Subscribe to first-run setup progress events |
| `getPlatform()` | Returns `process.platform` (`'win32'`, `'darwin'`, `'linux'`) |
| `startSetup()` | Signal main process that the renderer is ready to begin setup |
| `completeSetup()` | Signal main process that setup is complete — opens the main window |

### Setup progress events

During first-run setup, `main.js` forwards events from `backend.js` to the renderer via `ipcRenderer.on('setup-progress', ...)`. The `setup.html` page uses `onSetupProgress` to update the stage indicator, progress bar, and log.

`backend.js` parses pip stdout/stderr via `makeProgressTracker()` and emits three event types:

| `type` | Additional fields | Meaning |
|---|---|---|
| `phase` | `phase: 'resolving' \| 'downloading' \| 'installing' \| 'starting'` | Install stage changed |
| `progress` | `phase`, `downloadedMB`, `totalMB`, `speedMBps?`, `etaSeconds?`, `currentPackage?`, `currentPackageMB?` | Download progress update |
| `log` | `line: string` | Raw pip output line |

Phase transitions are detected by parsing pip output patterns:
- `Downloading *.whl (X MB)` or `Using cached *.whl (X MB)` → `downloading`
- `Installing collected packages:` → `installing`
- After pip exits successfully → `starting` (emitted by `startBackend`)

---

## Settings

Settings are stored in `app.getPath('userData')/settings.json`. The main process reads this file before spawning the backend to extract `hfToken`.

Default values are defined in `DEFAULT_SETTINGS` in `main.js`. The renderer merges saved values on top of defaults via `Object.assign(appSettings, saved)`.

`hfToken` is never passed to the renderer after loading — it is only used in `main.js` to set `HF_TOKEN` for the backend process.

---

## Audio playback

The transcript editor creates a single persistent `Audio` element per editor session. Its `src` is set to `'file://' + transcript.audio_path` — a direct filesystem path returned by the API. This works because the renderer page is loaded via `file://`, so `file:` is covered by the `default-src 'self'` CSP directive (explicitly enumerated as `media-src 'self' file:` in `index.html`).

The audio element survives editor rebuilds (triggered by speaker rename, segment edit, etc.) so playback is not interrupted. A cleanup hook on the root element pauses the audio and aborts all listeners when the user navigates to a different view.

---

## Live recording lifecycle

Recording runs entirely in the background — no dedicated recording view. The flow is:

1. User clicks **+** → `new-recording-modal.js` opens (source picker, model/language)
2. "Start recording" → modal closes; `app._startLiveRecording(settings)` runs
3. The **Record button** appears in the titlebar with a live elapsed timer (`0:00`, `1:23`, …)
4. User navigates freely while recording continues in the background
5. Clicking the **Record button** → `app._stopLiveRecording()` → saves file → `POST /transcribe` → progress view

**Source modes** (selected in `new-recording-modal.js`):

| `audioSource` | What is recorded |
|---|---|
| `mic` | Browser `getUserMedia` mic stream only |
| `system` | Backend `AudioCaptureService` (macOS/Linux) or WASAPI loopback (Windows) |
| `both` | Mic + system audio merged in browser via `AudioContext` |

**State in `app._liveSession`** (null when idle):

```js
{ recorder, audioCtx, micStream, sysStream,
  captureJobId, chunks, elapsed, timerInterval,
  settings: { title, model, language } }
```

`captureJobId` holds the backend job id from `POST /audio/capture/start`. Stop dispatches to `POST /audio/capture/stop/{captureJobId}`.

**Stop cases handled by `_stopLiveRecording()`:**

| Condition | Stop logic |
|---|---|
| `captureJobId && recorder` | Stop recorder → save mic blob → `POST capture/stop` with `mic_path` → merged `file_path` |
| `captureJobId` only | `POST capture/stop {}` → returns `file_path` |
| `recorder` only | Stop recorder → save blob → use temp path |

On success: `POST /transcribe` → `app.showProgress()`. On error: toast; `_setRecordingActive(false)`.

Clicking **+** while a session is active shows a toast ("Recording is already in progress") instead of opening the modal.

---

## First-run setup screens

`setup.html` shows a 3-step setup flow on the first launch of a packaged build (or when `SONORUS_TEST_SETUP=1` is set):

1. **Welcome** — intro screen, "Get started" button calls `electronAPI.startSetup()`
2. **Installing** — phase/progress/log events from `backend.js` update the stepper and progress bar
3. **Permissions** — mic and screen-recording grant buttons

**Note:** the Permissions screen is currently a UI mock. Clicking "Grant" marks the button green but does not trigger actual system permission requests. Both "Continue" and "Skip" dispatch `electronAPI.completeSetup()` and are equivalent.

---

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Only `electronAPI.*` methods are exposed to the renderer
- CORS in FastAPI is restricted to `null`, `127.0.0.1`, `localhost`
- Media permissions granted only for `permission === 'media'` (microphone)
