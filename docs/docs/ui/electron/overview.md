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
      speakers.css     — Sidebar section tabs, speaker list, speaker page
      views.css        — Toasts, misc shared view styles
      modal.css        — Modal overlay styles
    views/
      new-recording-modal.js  — Recording setup modal (source picker, model/language, toggles)
      alignment-modal.js      — Alignment model download + retry (shown on alignment_model_missing error)
      editor-view.js          — Transcript editor entry point
      settings-view.js        — Settings screen
      speakers-view.js        — Speakers section: sidebar list items + speaker page
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
| `saveRecording(buffer, ext)` | Write a recording buffer to `userData/recordings/` |
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

Default values are defined in `DEFAULT_SETTINGS` in `main.js` (used when `settings.json` is missing) and in `DEFAULT_APP_SETTINGS` in `app.js`. The renderer starts `appSettings` as a copy of `DEFAULT_APP_SETTINGS` and merges saved values on top via `Object.assign(appSettings, saved)`.

The last two sections of the Settings screen are destructive and use the same two-step confirmation (`Reset…` / `Delete…` → `Cancel` + a red confirm button):

- **Reset to defaults** writes `DEFAULT_APP_SETTINGS` back to `settings.json` via `defaultSettingsPatch()` (`utils.js`), keeping `hfToken`, re-applies the zoom and re-renders the page. Transcripts, models and recordings are not touched.
- **Delete all data** calls `POST /data/reset`, then clears `_activeTranscriptId`, reloads the sidebar (transcripts and the Speakers list) and shows a toast built by `formatDataResetSummary()`. The trigger button is disabled (with the reason from `dataResetBlockReason()` as its tooltip) while a background transcription job or a live recording is running; the backend enforces the same rule with `409`. Models, preferences and imported audio files are kept.

`hfToken` is part of `appSettings` in the renderer (Settings → API Keys edits it, and it is sent as `hf_token` with model download requests). `main.js` reads it once at startup to set `HF_TOKEN` for the backend process, so a changed token reaches the transcription pipeline only after an app restart.

---

## Audio playback

The transcript editor creates a single persistent `Audio` element per editor session. Its `src` is set to `fileUrl(transcript.audio_path)` (`utils.js`) — a `file://` URL built from the filesystem path returned by the API, with every path segment percent-encoded so spaces, non-ASCII characters, `#` and `?` survive, and Windows drive letters handled. The encoded form is stable under browser URL normalisation, so the `audio.src !== audioSrc` check does not reset playback on every editor rebuild. This works because the renderer page is loaded via `file://`, so `file:` is covered by the `default-src 'self'` CSP directive (explicitly enumerated as `media-src 'self' file:` in `index.html`).

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
  captureJobId, chunks, timerInterval,
  settings: { title, model, language } }
```

`captureJobId` holds the backend job id from `POST /audio/capture/start`. Stop dispatches to `POST /audio/capture/stop/{captureJobId}`.

**Stop cases handled by `_stopLiveRecording()`:**

| Condition | Stop logic |
|---|---|
| `captureJobId && recorder` | Stop recorder → save mic blob → `POST capture/stop` with `mic_path` → merged `file_path` |
| `captureJobId` only | `POST capture/stop {}` → returns `file_path` |
| `recorder` only | Stop recorder → save blob → use temp path |

On success: `POST /transcribe` → `app._addJob()` — transcription runs in the background queue. On error: toast; `_setRecordingActive(false)`.

Clicking **+** while a session is active shows a toast ("Recording is already in progress") instead of opening the modal.

---

## Deleting a transcript

Hovering a transcript in the sidebar (Transcripts tab) replaces its time with a trash icon (`.rec-item-delete`, a `span role="button"` because the item itself is a `<button>`). Clicking it opens `openConfirmDialog()` (`components.js`) with the text from `deleteTranscriptPrompt()` (`utils.js`); Escape or a backdrop click cancels. On confirm, `app._deleteTranscript()` calls `DELETE /transcripts/{id}` (a `404` counts as already deleted), removes the item via `withoutRecording()`, goes home if that transcript was open (`_activeTranscriptId`), reloads the sidebar and shows a toast. The backend also deletes the app's own live recording for that transcript; imported audio files are kept.

---

## Speakers section

The sidebar header has two tabs, **Transcripts** and **Speakers** (`.sb-tab`), each with its own pane (`#sb-pane-transcripts`, `#sb-pane-speakers`). `app._showSection()` only toggles the tab and pane; `showSpeakers()` / `showSpeaker(id)` also render the main panel. Opening a transcript (`showEditor`) or going home switches back to the Transcripts tab; switching back by hand reopens the last transcript.

- **List** — every `GET /speakers` row (`app._speakers`, loaded by `_loadSidebar()` together with the transcripts). Search matches the display name case-insensitively; the **All / Named / Unnamed** filter narrows it (`filterSpeakers()` in `utils.js`, unnamed speakers never match a non-empty query). Speakers that share a name get a *same name* badge (`duplicateNameIds()`); the speaker picker in the editor shows their usage line (`speakerStatsLine()`) next to the name so they can be told apart.
- **Speaker page** (`renderSpeakerDetail()` in `speakers-view.js`) — inline name field (Enter or **Save** sends `PATCH /speakers/{id}`, Escape reverts; a name another speaker also has is saved and noted under the field), color swatches (named speakers only — unnamed ones are always grey), statistics, and **Appears in** (`GET /speakers/{id}/transcripts`; clicking a row opens the editor).
- **Voice sample** — the page header plays the most characteristic segment (`GET /speakers/{id}/sample`) with its text as a quote; each **Appears in** row has its own ▶ that fetches a sample from that transcript on first click. One `Audio` element per page (`makeSamplePlayer()`), one sample at a time, a preview stops at the segment end or after 15 s, and playback stops when the page is left (`_cleanup`). Missing audio shows "Audio unavailable".
- **Delete** — **Delete speaker…** opens `openConfirmDialog()` with `deleteSpeakerPrompt()` (it says how many segments in how many transcripts become Unassigned) and calls `DELETE /speakers/{id}`. Like *Delete all data*, the button is disabled with the `dataResetBlockReason()` tooltip while a transcription job or live recording runs; the backend answers `409` in that case too.

After a change the sidebar is reloaded so transcript avatars and the editor pick up new names and colors.

### Unassigned segments in the editor

`effectiveSpeaker()` returns `UNASSIGNED` for a segment with `unassigned: true`. The editor treats it as one group: labelled **Unassigned** in segment rows and the waveform tooltip, excluded from the `Unknown N` numbering and from the header speaker count, and shown in its own right-panel section whose **Assign speaker** reassigns all of them (`POST /transcripts/{id}/reassign` with `from_speaker_id: "UNASSIGNED"`). A single segment is assigned from its speaker-name button as usual.

---

## Background transcription queue

Transcription runs entirely in the background — the main panel is never replaced by a progress view. The user can navigate freely (open other transcripts, change settings) while jobs run.

**Flow:**

1. File imported or recording stopped → `POST /transcribe` → `app._addJob(job_id, body)`
2. A job card appears in the **sidebar queue section** (above the recordings list) showing title, spinner, and current step text
3. Multiple jobs can be queued; the backend processes them serially (`ThreadPoolExecutor(max_workers=1)`)
4. On completion: toast notification (`✓ filename`) + sidebar refreshes; no auto-navigation
5. On `alignment_model_missing` error: `renderAlignmentModal()` opens as an overlay — user downloads the model and clicks Retry

**Job states in the sidebar card:**

| State | Icon | Status text |
|---|---|---|
| Queued (waiting for executor) | Empty circle | `Queued` |
| Running | Spinning circle | Step text (`Loading models…`, `Diarizing…`, …) |
| Error | Red `!` | Error message; `×` dismisses the card |

**State in `app._activeJobs`** (`Map<jobId, job>`):

```js
{ jobId, title, status, ws, originalRequest, error }
```

`status` is the latest step string from the WebSocket. `error` is `null` while running; set to the error message string on failure.

**Cancel:** clicking `×` on a running/queued card sends `DELETE /transcribe/{jobId}`. The backend sets the `threading.Event`; the WS receives `cancelled` and the card is removed.

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
