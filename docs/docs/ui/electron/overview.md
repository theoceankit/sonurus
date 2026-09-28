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
    icons/             — every UI icon as <name>.svg (see Icons page)
  renderer/
    index.html         — App shell: left sidebar + main panel
    setup.html         — First-run setup screen (shown during pip install)
    icons.js           — icon(name, size), hydrateIcons: renders files from assets/icons/
    utils.js           — API_BASE, WS_BASE, speaker helpers, fmtTime, makeAvatar
    components.js      — makeDropdown (shared UI component)
    data.js            — LANGUAGES (static), MODELS (fallback), ALIGNMENT_MODELS (source of truth)
    file-drop.js       — initFileDrop: window drag-and-drop of audio files + drop overlay
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
        tooltip.js, speaker-picker.js, new-speaker-modal.js, segment-row.js,
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
- **Delete all data** calls `POST /data/reset`, then clears `_activeTranscriptId`, reloads the sidebar (transcripts and the Speakers list) and shows a toast built by `formatDataResetSummary()`. The trigger button is disabled (with the reason from `dataResetBlockReason()` as its tooltip) while a background transcription job or a live recording is running; the backend enforces the same rule with `409`. Models, preferences and the user's original imported files are kept (the app's copies in `recordings/` are removed).

`hfToken` is part of `appSettings` in the renderer (Settings → API Keys edits it, and it is sent as `hf_token` with model download requests). `main.js` reads it once at startup to set `HF_TOKEN` for the backend process, so a changed token reaches the transcription pipeline only after an app restart.

---

## Audio playback

The transcript editor creates a single persistent `Audio` element per editor session. Its `src` is set to `fileUrl(transcript.audio_path)` (`utils.js`) — a `file://` URL built from the filesystem path returned by the API, with every path segment percent-encoded so spaces, non-ASCII characters, `#` and `?` survive, and Windows drive letters handled. The encoded form is stable under browser URL normalisation, so the `audio.src !== audioSrc` check does not reset playback on every editor rebuild. This works because the renderer page is loaded via `file://`, so `file:` is covered by the `default-src 'self'` CSP directive (explicitly enumerated as `media-src 'self' file:` in `index.html`).

The audio element survives editor rebuilds (triggered by speaker rename, segment edit, etc.) so playback is not interrupted. A cleanup hook on the root element pauses the audio and aborts all listeners when the user navigates to a different view.

---

## Live recording lifecycle

Recording runs entirely in the background — no dedicated recording view. The flow is:

1. User clicks **+** → `new-recording-modal.js` opens (source picker, model/language)
2. "Start recording" → modal closes; `app._startLiveRecording(settings)` runs. It first sends `POST /queue/recording/start`: the queue pauses and a running transcription stops at once, so the recording gets the CPU/GPU
3. The **Record button** appears in the titlebar with a live elapsed timer (`0:00`, `1:23`, …)
4. User navigates freely while recording continues in the background
5. Clicking the **Record button** → `app._stopLiveRecording()` → saves file → `POST /queue/jobs` → the recording joins the end of the transcription queue

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

The file is queued with `app._importFiles()` (`POST /queue/jobs`). Afterwards — also after an error (toast) — `_setRecordingActive(false)` and `POST /queue/recording/stop`: the queue resumes by itself only in the automatic start mode and only if the recording paused it. A recording that fails to start sends `recording/stop` too.

Clicking **+** while a session is active opens the modal for imports only: "Start recording" is disabled (tooltip "A recording is already in progress"). Imports and drops during a recording are queued and wait.

---

## Renaming a transcript

The editor title (`.focus-title`) is editable: a click, or Enter while it has focus, swaps it for an input (`.focus-title-input`, text selected). Enter or leaving the field saves, Escape cancels. `titleToSave()` (`utils.js`) skips a blank or unchanged title or one over 200 characters; otherwise `PATCH /transcripts/{id}` is sent via `transcriptTitleRequest()`. The new title is shown at once and the sidebar reloads on success; on an error the old title comes back with a toast. The title is always set with `textContent`.

---

## Deleting a transcript

Hovering a transcript in the sidebar (Transcripts tab) replaces its time with a trash icon (`.rec-item-delete`, a `span role="button"` because the item itself is a `<button>`). Clicking it opens `openConfirmDialog()` (`components.js`) with the text from `deleteTranscriptPrompt()` (`utils.js`); Escape or a backdrop click cancels. On confirm, `app._deleteTranscript()` calls `DELETE /transcripts/{id}` (a `404` counts as already deleted), removes the item via `withoutRecording()`, goes home if that transcript was open (`_activeTranscriptId`), reloads the sidebar and shows a toast. The backend also deletes the app-owned audio for that transcript (live recording or copy of an imported file); the user's original imported file is kept.

---

## Speakers section

The sidebar header has two tabs, **Transcripts** and **Speakers** (`.sb-tab`), each with its own pane (`#sb-pane-transcripts`, `#sb-pane-speakers`). `app._showSection()` only toggles the tab and pane; `showSpeakers()` / `showSpeaker(id)` also render the main panel. Opening a transcript (`showEditor`) or going home switches back to the Transcripts tab; switching back by hand reopens the last transcript.

- **List** — every `GET /speakers` row (`app._speakers`, loaded by `_loadSidebar()` together with the transcripts). Search matches the display name case-insensitively; the **All / Named / Unnamed** filter narrows it (`filterSpeakers()` in `utils.js`, unnamed speakers never match a non-empty query). Speakers that share a name get a *same name* badge (`duplicateNameIds()`); the speaker picker in the editor shows their usage line (`speakerStatsLine()`) next to the name so they can be told apart.
- **Speaker page** (`renderSpeakerDetail()` in `speakers-view.js`) — inline name field (Enter or **Save** sends `PATCH /speakers/{id}`, Escape reverts; a name another speaker also has is saved and noted under the field), color swatches (named speakers only — unnamed ones are always grey), statistics, and **Appears in** (`GET /speakers/{id}/transcripts`; clicking a row opens the editor).
- **Voice sample** — the page header plays the most characteristic segment (`GET /speakers/{id}/sample`) with its text as a quote; each **Appears in** row has its own ▶ that fetches a sample from that transcript on first click. One `Audio` element per page (`makeSamplePlayer()`), one sample at a time, a preview stops at the segment end or after 15 s, and playback stops when the page is left (`_cleanup`). Missing audio shows "Audio unavailable".
- **Delete** — **Delete speaker…** opens `openConfirmDialog()` with `deleteSpeakerPrompt()` (it says how many segments in how many transcripts become Unassigned) and calls `DELETE /speakers/{id}`. Like *Delete all data*, the button is disabled with the `dataResetBlockReason()` tooltip while a transcription job or live recording runs; the backend answers `409` in that case too.

After a change the sidebar is reloaded so transcript avatars and the editor pick up new names and colors.

### Assigning a speaker in the editor

The speaker picker (`speaker-picker.js`) opens from a segment's speaker name (assigns that segment only) or from a right-panel card's **Assign speaker** (assigns every segment of that speaker in the transcript). Its search filters the named speakers; clicking one or pressing Enter assigns it. The request is built by `speakerAssignRequest()` (`utils.js`): `PATCH /transcripts/{id}/segments/{start}/speaker` for one segment, `POST /transcripts/{id}/reassign` for all.

The footer button **Add new speaker…** (or Enter when nothing matches the search) closes the picker and opens `openNewSpeakerModal()` (`new-speaker-modal.js`):

- **Name** — required (**Add speaker** is disabled while empty), prefilled with the picker search text. A name another speaker already has is allowed and noted under the field (`hasSpeakerNamed()`).
- **Color** — palette swatches; the default is the color the fewest named speakers use (`leastUsedColorIndex()`). Sent as `color_index` with the name, so the speaker is created with it in one request.
- **Assign to** — opened from a segment row: a toggle between *This segment* and *All segments of “X”*; opened from a card: a note that all segments of that speaker are assigned.

Enter submits, Escape / backdrop / Cancel close it. A failed request keeps the dialog open and shows the error under the name.

### Editor reload

Every edit in the editor (assigning a speaker, confirming a suggestion, editing or deleting a segment) calls `reload()` in `editor-view.js`, which fetches the transcript, speakers and suggestions again and rebuilds the editor with `buildEditor()`. The rebuild replaces the segment list and the right panel, so `reload()` wraps it in `preserveScroll()` (`utils.js`) to keep the scroll position of `.seg-list` and `.right-content`.

### Unassigned segments in the editor

`effectiveSpeaker()` returns `UNASSIGNED` for a segment with `unassigned: true`. The editor treats it as one group: labelled **Unassigned** in segment rows and the waveform tooltip, excluded from the `Unknown N` numbering and from the header speaker count, and shown in its own right-panel section whose **Assign speaker** reassigns all of them (`POST /transcripts/{id}/reassign` with `from_speaker_id: "UNASSIGNED"`). A single segment is assigned from its speaker-name button as usual.

---

## Transcription queue

The backend owns the queue ([Transcription Queue](../../services/TranscriptionQueue.md)); the renderer only shows it and sends commands. The main panel is never replaced by a progress view.

**Connection:** `app._connectQueue()` (in `init()`) opens `WS /ws/queue` and keeps the latest snapshot in `app._queue`. The socket reconnects every 2 s while the backend is away (restart); its first snapshot shows the new state (paused if jobs were left waiting).

**Events** (`app._onQueueEvent()`):

| Event | Renderer |
|---|---|
| `snapshot` | `app._queue` = snapshot; `_renderJobQueue()` |
| `job_done` | Sidebar reloads; toast `✓ title`; no auto-navigation |
| `job_failed` | Toast `Transcription failed: title` — or, for `alignment_model_missing`, `renderAlignmentModal(language, jobId)`: download the model, then **Retry transcription** (`POST /queue/jobs/{id}/retry`) |

**Sidebar queue section** (`#job-queue`, above the recordings list, hidden while the queue is empty):

- Header: `Queue · N`, the state from `queueStateLabel()` (`Running` in green, `Paused`, `Paused while recording`) and a **Pause** / **Start** button (`queueToggle()` → `POST /queue/pause|start`). Start is allowed during a recording too.
- One card per job, in queue order:

| Job | Icon | Status line (`jobStatusText()`) | Buttons |
|---|---|---|---|
| Running | Spinner | The snapshot's `step` (`Loading models…`, `Transcribing audio…`, …) | × |
| Waiting | Empty circle | `Waiting`, or `Waiting · queue paused` | Edit, × |
| Failed | Red `!`, red card | First line of the error (full text in the tooltip); a missing alignment model is named | Edit, Retry (`retry` icon), × |

- **×** opens `openConfirmDialog()` with `deleteJobPrompt()`: an import says the app's copy goes and the original is kept; a live recording says it is deleted for good. Confirm → `DELETE /queue/jobs/{id}` (a running job is stopped first).
- **Edit** (`edit` icon, every job except the running one — `canEditJob()`) opens `openJobEditModal()` (`views/queue-job-modal.js`): title, Whisper model (installed state from `GET /models`) and language (`Detect automatically` = null). `jobEditPatch()` sends only the changed fields (`PATCH /queue/jobs/{id}`); a blank title or one over 200 characters is refused in the dialog, and a server error (e.g. the model is not installed, or the job started meanwhile → 409) keeps the dialog open with the message.
- **Order:** drag a card onto another (`app._attachJobDrag()`); the upper / lower half of the target decides before / after (`dropPlace()`), `reorderJobIds()` builds the new order and `PUT /queue/order` stores it. The insertion line is a shadow, so no card moves while dragging. Snapshots that arrive during a drag are kept and drawn at `dragend`, because rebuilding the cards would end the drag. Only drags carrying a job id (`application/x-sonorus-job`) are handled; file drops stay with `file-drop.js`.
- Queue calls go through `app._queueRequest()`: an error becomes a toast.

**Adding jobs:** `app._importFiles(paths, options)` posts `importRequest()` (`POST /queue/jobs`) one file at a time; the card appears with the next snapshot. Used by the New Recording modal, window drops and a stopped recording.

**Start mode:** Settings → ML Models → **Start transcription** (`Automatically` / `Manually`), stored by the backend (`PUT /queue/settings`), not in `settings.json`.

**Delete all data** is disabled while a job is running ("Pause the transcription queue first."); queued jobs are removed by the reset.

---

## Dropping files to transcribe

Audio files dropped on the window go straight to the transcription queue — no modal. `initFileDrop()` (`file-drop.js`) listens on `window` and touches only drags that carry files (`dataTransfer.types` includes `Files`), so text drags keep working. What a drop does is decided by `dropDecision()` (`utils.js`) from `app._fileDropState()`:

| Situation | Result |
|---|---|
| Home or editor (`_currentView` `import` / `editor`) | Overlay over `#main-panel` (`.fd-overlay`); on drop every supported file is queued |
| Settings or Speakers | Ignored: no overlay, drop effect `none` |
| Any modal open (`.nr-overlay`) | Ignored — the New Recording modal handles its own drop |

A live recording does not block drops: it pauses the queue, so dropped files wait at the end of it.

- Supported types are `SUPPORTED_AUDIO_EXTENSIONS` (`utils.js`, same list as the file dialog filter in `main.js`), checked by `isSupportedAudio()`. Other files are skipped with a toast ("Skipped N unsupported files"); the New Recording modal rejects them too.
- Several files are sent one `POST /queue/jobs` at a time by `app._importFiles()` (shared with the modal), in drop order. Each request waits while the backend copies the file into `recordings/`, so a toast ("Importing N files…") is shown right away.
- Model and language come from `appSettings.transcribeModel` / `transcribeLang` (`importRequest()`); the title is left `null`, so the backend uses the file name without its extension (the job card shows the same).
- A drop that a drop zone below already handled (`defaultPrevented`, i.e. the modal) is skipped, otherwise the modal — already closed by then — would be imported twice.
- `dragover` / `drop` with files are always cancelled, in every view: an unhandled file drop makes Electron open the file in the window.

---

## First-run setup screens

`setup.html` shows a 3-step setup flow on the first launch of a packaged build (or when `SONORUS_TEST_SETUP=1` is set):

1. **Welcome** — intro screen, "Get started" button calls `electronAPI.startSetup()`
2. **Installing** — phase/progress/log events from `backend.js` update the stepper and progress bar
3. **Permissions** — mic and screen-recording grant buttons

**Note:** the Permissions screen is currently a UI mock. Clicking "Grant" marks the button green but does not trigger actual system permission requests. Both "Continue" and "Skip" dispatch `electronAPI.completeSetup()` and are equivalent.

---

## Icons

Every UI icon is a file in `electron/assets/icons/`, rendered by `icons.js` as a CSS mask over
`currentColor`. Usage, file rules and where each icon is used: [Icons](./icons.md).

---

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Only `electronAPI.*` methods are exposed to the renderer
- CORS in FastAPI is restricted to `null`, `127.0.0.1`, `localhost`
- Media permissions granted only for `permission === 'media'` (microphone)
- `will-navigate` is cancelled for the main window: pages never navigate themselves (`setup.html` → `index.html` is `loadFile()` from `main.js`)
