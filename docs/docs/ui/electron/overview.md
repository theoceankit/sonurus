---
sidebar_position: 1
---

# Electron UI

A desktop window built with Electron. The main process (`electron/`) starts the backend and opens the window; the window shows the UI, a React and TypeScript app in `ui/`, a separate npm package built into `ui/dist`. The UI talks to the Python FastAPI server over HTTP and WebSocket.

---

## Running in dev mode

```bash
npm --prefix ui ci                  # once; needs Node.js 22.22.2+
npm run build:ui                    # build into ui/dist
npm start                           # Electron with the build
npm run dev:ui                      # Vite and Electron, hot reload (arguments go to Electron)
VITE_SONORUS_FIXTURES=1 npm run dev:ui  # the same on fixtures
npm --prefix ui run storybook       # http://localhost:6006
npm --prefix ui test                # Vitest
npm --prefix ui run typecheck
npm run test:e2e                    # the built app end to end, see Testing
```

`electron/backend.js` starts the FastAPI server before the window opens. If a server is already listening on port 8000, the spawn is skipped.

To start the backend by hand (e.g. for isolated API testing):
```bash
# Do NOT add --reload — watchfiles triggers on .py files in .models/ and kills downloads
.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

Screens get their data through one client, on the backend or on fixtures: see [UI data](data.md). Where a run keeps its data, how to check a change on isolated data, when to restart Vite or Storybook and what the tests cannot show: see [Development](development.md). The base of every screen (tokens, font, icons, overlays, motion) is in [Foundations](foundations.md).

Every component lives in `ui/src/components/<Name>/` and has `<Name>.stories.tsx` with a story for each of its states. Storybook finds these files by itself; a component without one is simply absent from it, so a build test checks that the file exists. Whether the stories cover all states is checked by review.

The stories under `Redesign/Editor` reproduce the Editor design boards at 1200×800 and carry their names, so a story can be compared with its board. A test holds the list of names.

---

## What the window loads

`electron/ui-entry.js` decides:

| Environment | Development | Packaged |
|---|---|---|
| — | `ui/dist/index.html` | `ui/dist/index.html` |
| `SONORUS_UI_DEV_URL` | that URL | `ui/dist/index.html` |

A missing build stops with an error dialog naming `npm run build:ui`. `npm run dev:ui` (`scripts/dev-ui.js`) starts Vite and sets `SONORUS_UI_DEV_URL` for Electron.

`ui/index.html` carries the CSP: requests and the WebSocket go to `http://localhost:8000` only, media comes from there or from `blob:` and never from `file:`, and no workers. Hot reload needs an inline script and the dev server's WebSocket: a plugin in `ui/vite.config.ts` adds `script-src 'self' 'unsafe-inline'` and `ws://localhost:5173` on the dev server only. A build test keeps the CSP of the source and of a build.

The dev server's origin is not one the backend accepts, so `npm run dev:ui` sets `SONORUS_DEV_UI_ORIGIN`. A backend started earlier without it, e.g. with `uvicorn`, refuses requests from the dev page.

---

## Window and Editor shell

The window has no system frame (`electron/window-chrome.js`). The system's window buttons stay and stand over the page, in the title bar's colours of the theme the window is in (`--color-bg-sunken` behind them, `--color-text-primary` for the symbols); the window's own background, seen before the page has drawn, is the same `--color-bg-sunken`. When the theme changes, by the setting or by the system, the main process hears `nativeTheme`'s `updated`: the window's background takes the new colour at once, and `overlayDimmer()` moves the strip to it in 250 ms on `--ease-standard`, as the page cross-fades; a modal opening meanwhile dims it on the way. Which side they are on depends on the system and the desktop, so `Titlebar` reads the free area from `env(titlebar-area-*)` and keeps its controls clear of it. The window is dragged by the free parts of the title bar: the strip has `-webkit-app-region: drag`, its buttons and the search field `no-drag`.

The system draws the strip of the window buttons over the page, so a modal's scrim does not reach it. While a modal is open, the window dims the strip itself to the colour of the page under the scrim (`--color-scrim` of the theme over `--color-bg-sunken`, and over `--color-text-primary` for the symbols), in 200 ms on the enter curve and back in 150 ms on the exit curve, as the scrim does. `Modal` holds the dim through `holdWindowDim()` in `ui/src/platform/window-dim.ts`, which sends `setWindowDimmed` of the preload only when the first modal opens and the last one closes, after the changes of one render: a window that takes over from another keeps the strip dimmed, and a preview does not dim it. With the change it sends the time of the next animation frame, when the scrim starts to move. In the main process `overlayDimmer()` of `electron/window-chrome.js` moves the colours with `setTitleBarOverlay` about every 16 ms, counting from that time rather than from when the message arrived (at most 50 ms back), so the strip keeps pace with the scrim; it starts from wherever the strip is, so closing halfway does not jump; a build test keeps its colours, durations and curves equal to the tokens. A page that loads again starts undimmed. macOS draws its own window buttons with no strip, so they stay as they are there.

`ui/src/screens/Editor/EditorScreen.tsx` lays out the window: `Titlebar`, `Sidebar`, and the transcript, inspector and player panels. The transcript panel shows `TranscriptPanel` ([Transcript](transcript.md)), the inspector `InspectorPanel` ([Inspector](inspector.md)) and the player panel `EditorPlayer` ([Player](player.md)); the screen holds the playback they follow. With no recording open the centre shows the empty state ([Home](home.md)). Back and Forward in the titlebar go through the recordings opened ([Home](home.md#back-and-forward)). The Speakers button of the titlebar opens the Speakers window ([Speakers](speakers.md)), the Settings button the Settings dialog ([Settings](settings.md)).

| Window width | Side panels |
|---|---|
| 1112 and more | Both; the centre takes what is left, at least 480 |
| Below 1112 | One. The sidebar stays and the inspector goes; opening either one hides the other |

The width is that of the screen, so a story can show any size. A panel the user closed stays closed when the window widens; one hidden for lack of room comes back. While the inspector is hidden, a button next to Settings opens it. Each of the inspector's two buttons goes as the panel moves, so focus from the keyboard on one goes on to the other: Close inspector hands it to Show inspector and back. After a click the focus is left alone. What is open is not remembered between runs. The rules are pure functions in `panels.ts`. A panel moves on its button and not when the window is resized: see [Motion](foundations.md#motion).

`Sidebar` shows the recordings in the sections Pinned, This week and Earlier, worked out on the client in `recordings.ts` rather than taken from `section` of the API: This week is today and the seven calendar days before it, and a section with nothing in it is left out. The API has no pinned recordings yet, so in the app the section does not appear; `EditorScreen` takes them as a prop, and the story Screens / Editor / Board uses it to match the design. A recording the user has not opened yet shows a dot, labelled New (`opened` of the API). A speaker with no name shows as the unknown avatar in the row, not as the dot. Rows show three avatars at most, with no count of the others. The list has no scrollbar: it would narrow the rows, and the fade at the bottom says there is more. Above the recordings stand the live recording ([Live recording](live-recording.md)) and the transcription queue ([Transcription](transcribe.md)).

### Menu of a recording

A right click on a row, or the Menu key or Shift+F10 on a focused one, opens its menu (`ContextMenu`, [Foundations](foundations.md#menu)); it does not open the recording. While the menu is open the row looks as under the pointer. There is no More button in the row: the avatars keep their place. `Sidebar` takes the items as `rowMenu` and the row being renamed as `renamingId`; `EditorScreen` puts in:

- **Rename.** The title becomes a field in the row (`TitleField`, shared with the [transcript header](transcript.md)), with the text selected; the dot and the avatars stay. Enter and leaving the field save, Escape cancels, and the focus goes back to the row. As in the header the title is trimmed, and a blank or unchanged one is not sent; the new title shows at once in the list and in the header of the open recording, and goes back with a toast if the request fails.
- **Mark as unread**, or **Mark as read** on a recording with the dot. The dot changes at once (`useSetOpened()`: `DELETE` or `POST /transcripts/{id}/opened`) and comes back as it was, with a toast, if the request fails. On the open recording the dot stays until it is opened again: `useMarkOpened` asks once per opening, also for one that was opened before.
- **Pin**, not available yet.
- **Delete recording**, below a divider. The same `DeleteRecordingDialog` as in the header: deleting the open recording does what it does there ([Home](home.md#which-recording-is-open)); deleting another one leaves the open one.

---

## Backend lifecycle

`electron/backend.js` manages the server process:

1. `checkHealth()` — polls `GET /health`. If already responding, skips spawn (`electron/backend-identity.js` decides whether that backend may be reused: see [Configuration](../../environment/configuration.md#sonorus_data_dir)).
2. Spawns `uvicorn` with the bundled interpreter (packaged: `resources/backend/python-dist`, which
   already contains every library — see [Packaging](../../distribution/packaging.md); dev: `.venv`) and env
   `HF_TOKEN`, `SONORUS_DATA_DIR`, `SONORUS_VERSION`, and without `LOG_FILE`, even one inherited from the
   environment: its log reaches `sonorus.log` through its stderr (see [The app log](#the-app-log)); packaged
   builds also put the bundled `ffmpeg` first on `PATH`.
3. `waitForReady()` — polls `/health` up to 60s, logs `[backend] ready in N ms`, then `main.js` opens the window.
4. `stopBackend()` — kills the process on `will-quit`.

### The app log

`sonorus.log` in `userData` is the log to look at, or to send, on every OS. The main process is its only writer (`electron/log.js`):

- **Lines of the main process** go through `log(line)`, never `console.*` (a test checks it): `log('[tray] …')` writes `HH:MM:SS [tray] …`, the format of the backend's lines, and shows the line in the console too. The source in brackets is part of the line: `[backend]` for the start-up and the GPU pack, `[notifications]` for refusals of the system.
- **The backend's stderr**, when the main process started the backend: its own log (`HH:MM:SS [Service] …`, [Logging](../../environment/logging.md)), uvicorn's start-up lines and tracebacks, and whatever the pipeline or the ML libraries print. It goes in as it is, a whole line at a time; a line redrawn with `\r` (a progress bar) keeps its last state. It shows in the console as before, after `[backend] `. stdout — uvicorn's line per request — only goes to the console.
- **One writer**, because on Windows Python appends with a seek and a write, so lines of two writers could overwrite each other, and a file Python holds open cannot be renamed. A reused backend (dev, or one that outlived a crash of the app) writes nothing there: its stderr is not ours.
- **Rotation.** At start-up, in the first instance only and before the backend starts, a log over 5 MiB becomes `sonorus.log.1` (replacing the previous one) and a new one starts.
- **A log that cannot be written** (no access, a full disk) loses the line and nothing else; the next line tries again.

There is no first-run setup: every launch, packaged or dev, goes straight to the window.

---

## Tray and quitting

Closing the window does not quit Sonorus: the window is destroyed and the app keeps running in the tray, with its backend, so a live recording or a transcription goes on ([Live Recording](live-recording.md)). `electron/tray.js` holds the rules as pure functions; `main.js` wires them.

- **Tray.** On macOS a template image in the menu bar (`assets/trayTemplate.png`, see [Icons](../../distribution/packaging.md#icons)): black with the shape in alpha, so the menu bar tints it for its light or dark look. On Windows the same quill, white on a dark taskbar and black on a light one (`assets/trayOnDark.ico`, `assets/trayOnLight.ico`): the colour follows the Windows mode, not the mode of the apps or the theme set in Sonorus. `electron/taskbar-theme.js` reads it from the registry (`SystemUsesLightTheme`, by `reg query`; dark when it cannot be read) before the tray is made and again 0.3 s after a `WM_SETTINGCHANGE` or `nativeTheme`'s `updated`. The message comes to a window that is never shown (`BaseWindow`), so the icon changes with the main window closed too. `nativeTheme.shouldUseDarkColorsForSystemIntegratedUI` is not used: until the first theme update it gives the theme of the apps, and the Windows mode changed alone sends no update. On Linux nothing tells the colour of the panel, so one white quill in a dark outline that shows on any (`assets/trayLinux.png`). Tooltip Sonorus, menu Open Sonorus, the recording item (below) and Quit Sonorus. Open Sonorus, a click on the icon (Windows, KDE; on GNOME a click opens the menu) and, on macOS, a click on the Dock icon open the window again, or bring it to the front. A new window opens as at start-up: the recording opened last, and a recording in progress from the queue snapshot.
- **Is there a tray.** Windows and macOS always have one. On Linux the icon goes to the StatusNotifierItem host (KDE, GNOME with the AppIndicator extension, most others) and Electron says nothing when there is none, so at start-up the main process asks the session bus whether `org.kde.StatusNotifierWatcher` has an owner (`gdbus call … NameHasOwner`). No owner, or no `gdbus`: no tray, and closing the window quits as before.
- **Recording from the tray.** Between Open Sonorus and Quit Sonorus the menu has a recording item. It follows the phase of the recording in the snapshots of `WS /ws/queue`: New recording with none, Starting recording… (off), Stop recording while live, Saving recording… (off). While the connection is lost, until the first snapshot, and for a phase the menu does not know, it is New recording, off. The menu is built again only when the item changes. New recording and Stop recording do not record or stop by themselves: each brings the window to the front, making it again if it was closed to the tray, with an intent ([`takeWindowIntent()`](#ipc-bridge)) for the New recording dialog or the Stop recording? question ([Live Recording](live-recording.md#starting-and-stopping-from-the-tray)).
- **Close button.** `close` of the window first asks the page to save what waits ([`onWindowClosing()`](#ipc-bridge)), then reads `closeToTray` from `settings.json` (on unless `false`): with a tray and the setting on, the window is destroyed; otherwise the app quits, by the same way as Quit Sonorus. The first close to the tray shows a system notification, "Sonorus is still running. Quit it from the tray icon.", once: `trayHintShown` in `app-state.json` in `userData`, a file of the main process, as `settings.json` is rewritten whole by the renderer. It is remembered only when the system shows it (the notification's `show` event): refused, or with no notifications on the system, it comes again on the next close to the tray. It is a notification too: with Show notifications off (`notifications: false`) it does not show.
- **Finished and failed transcriptions.** The main process hears `job_done` and `job_failed` over `WS /ws/queue` (`electron/backend-events.js`) and passes them to `createJobNotices()` (`electron/job-notices.js`), so the user hears of a long queue with the window closed to the tray. Only while the window is not in front (`windowAway()`: no window, or one hidden, minimized or not focused); in front, its toast says it ([Transcription → Finished and failed jobs](transcribe.md#finished-and-failed-jobs)). Not with Show notifications or When a transcription is ready or fails off (`notifications`, `notifyTranscriptions` in `settings.json`; a file without the key has it on). A finished one: "Standup" is ready, "Click to open."; a failed one, a missing alignment model too: Transcription failed: "Standup", "Click to see what went wrong.", without the error, which can be long and is in the queue. Another of the same kind within 10 s of the one before replaces it (`close()` of the notifier) with one that counts them, "3 transcriptions are ready" or "3 transcriptions failed"; ready and failed do not mix, and the window coming to the front starts anew. A click brings the window to the front, making it again if needed, with an intent ([`takeWindowIntent()`](#ipc-bridge)): the recording (for a summary, the last one), the failed job in the queue (for a summary, the first one), or the Alignment model dialog of the model the job lacked. `EditorScreen` acts on it once the list of recordings or the queue has loaded, and only if the recording is still listed, the job still queued, or a job still waits for that model: else only the window comes up. No buttons on any system; Windows needs the AppUserModelID, macOS its permission, as for [the notifications of a call](live-recording.md#calls-starting-and-ending).
- **Notifications the system refuses.** Every notification of the main process goes through `createNotifier()` (`electron/notifications.js`). When the system does not show one — `failed` on macOS (an app it does not allow to notify) and Windows (notifications off for the app), or `Notification.isSupported()` false — the main process logs `[notifications] "<title>" not shown: <error>` and keeps the refusal, `{title, error}`, as `notificationRefusal` in `app-state.json`, for Settings → Notifications; the next notification the system shows clears it. Linux has no `failed` event: a refusal there is not seen.
- **Quitting.** Quit Sonorus, Cmd+Q, the close button without a tray and any other `app.quit()` go through `requestQuit()`, which reads `GET /queue`. Nothing running, or no backend answering: it quits. A live recording: a system dialog, "Recording is in progress. Stop it and quit?" — Stop and quit sends `POST /audio/recording/stop` and waits, up to 30 s, until the snapshot has no recording, so the recording is saved and queued first. A running transcription: "Transcription will be interrupted. Quit?"; the job goes back to waiting when the backend starts again. Cancel leaves everything as it was. Before it quits, the page is asked to save what waits, as before closing the window. Then `will-quit` stops the backend.
- **One app.** `app.requestSingleInstanceLock()` before the backend starts: a second launch with the same data dir quits at once, and the running app opens its window (`second-instance`). Dev and packaged apps have their own data dirs, so each has its own lock.

---

## File structure

```
electron/
  main.js              — BrowserWindow, IPC handlers, backend lifecycle orchestration
  backend.js           — Backend process spawn, health check, restart
  backend-identity.js  — Dev and packaged data dirs; whether a running backend may be reused
  log.js               — The app log, sonorus.log: lines of the main process, the backend's stderr, rotation
  dialog-folder.js     — Folder the file dialog opens in (last picked file, dialog-state.json)
  tray.js              — Close to the tray, the tray menu, what to ask before quitting
  backend-events.js    — WS /ws/queue in the main process, for the notifications of a call or a transcription
  recording-prompts.js — A call that seems to start or end: notification, stop or nothing
  notifications.js     — Shows notifications; logs and keeps the ones the system refuses
  job-notices.js       — Finished and failed transcriptions: when to notify, the summary of several
  gpu-pack.js          — The GPU pack: applying downloads and removals, its check at start
  ui-entry.js          — What the window loads: the build or the dev server
  taskbar-theme.js     — The colour of the Windows taskbar, for the tray icon
  window-chrome.js     — Frameless window, window buttons and their dimming
  window-closing.js    — Asks the page to save what waits before the window goes or the app quits
  links.js             — Links of a note: which addresses open outside the app
  preload.js           — contextBridge: exposes electronAPI.*
  assets/
    icon.png           — app icon master for Windows and Linux, 1024×1024 (see Packaging → Icons)
    icon-macos.png     — app icon master for macOS, 1024×1024
    logo.png           — transparent quill, source of the app icon masters
    trayTemplate.png   — macOS menu bar icon, 18×18 and @2x 36×36 (template image)
    trayOnDark.ico     — Windows tray icon for a dark taskbar, white, 16 to 48 px
    trayOnLight.ico    — Windows tray icon for a light taskbar, black, 16 to 48 px
    trayLinux.png      — Linux tray icon, white with a dark outline, 44×44
ui/
  index.html           — the page and its CSP
  src/main.tsx         — entry: theme, saved scale, providers, App
  src/App.tsx          — the window: Editor screen, toasts, queue and recording providers
  src/screens/         — Editor, Home, Queue, Settings, Speakers
  src/components/      — one folder per component, with its stories
  src/api/             — the API client, its generated types and fixtures
  src/platform/        — the preload bridge, settings.json, window dimming, theme
  src/media/           — playback of the recording, clips and voice samples
  src/transcribe/      — models, default model, downloads, languages
  src/recording/       — live recording
  src/styles/          — tokens, motion, shared styles
  src/assets/          — font and icons
  dist/                — the build Electron loads (npm run build:ui)
```

---

## IPC bridge

`preload.js` exposes the following via `contextBridge` as `window.electronAPI`; `ui/src/platform/electron-api.ts` holds its type, and a build test keeps the two in step:

| Method | Description |
|---|---|
| `openFiles()` | Native file-open dialog (audio/video filter, several files); resolves to the picked paths, `[]` when cancelled. Opens in the folder of the last picked file, also after a restart (`dialog-folder.js`, `dialog-state.json` in `userData`; a missing folder → the OS decides). Electron 43+ no longer leaves this to the OS |
| `getFilePath(file)` | Resolve a dropped `File` object to a filesystem path |
| `readSettings()` | Read `settings.json` from `app.getPath('userData')` |
| `writeSettings(data)` | Write `settings.json` to `app.getPath('userData')` |
| `setZoom(factor)` | Call `webContents.setZoomFactor(factor)` |
| `setTheme(source)` | Set `nativeTheme.themeSource` to `system`, `light` or `dark` (see [Settings](#settings)) |
| `writeClipboard(text)` | Write text to the system clipboard |
| `restartBackend()` | Restart the backend to apply a GPU download or removal (asked once `POST /gpu/restart` says `ready`); resolves when the new backend is up. See [GPU acceleration](./gpu-acceleration.md) |
| `showModelsFolder()` | Open the models folder in the file manager (Settings → Models). Takes no path: main asks the backend (`GET /models/folder`, `models-folder.js`) and opens that folder with `shell.openPath`, so the window cannot open anything else. Main opens only an absolute path to an existing folder named `.models`: `shell.openPath` runs a file with its default application, so not even what answers on the port can have it open anything else. Resolves to `''` once opened, else why not: the backend does not answer, the folder does not exist yet, the path is not a models folder, or the error of `shell.openPath` |
| `openLink(address)` | Ctrl/⌘+click on a link of a note: opens it with `shell.openExternal`, only `http`, `https` and `mailto` (`links.js`); resolves to `false` for anything else. See [Notes](notes.md#the-editor) |
| `onWindowClosing(callback)` | Before the window is closed to the tray or the app quits, main sends `window-closing` and waits, up to 1.5 s, until the callback's promise settles (`window-closing.js`): the page saves what still waits, such as a note. Returns what stops listening. See [Notes](notes.md#saving) |
| `setWindowDimmed(dimmed, startedAt)` | Dim or undim the strip of the window buttons with a modal's scrim (see [Window and Editor shell](#window-and-editor-shell)) |
| `getPlatform()` | Returns `process.platform` (`'win32'`, `'darwin'`, `'linux'`) |
| `getAppVersion()` | Returns `app.getVersion()` — the `version` field of `package.json` |
| `getTrayAvailable()` | Whether the system has a tray to keep the app in when its window closes (see [Tray and quitting](#tray-and-quitting)) |
| `takeWindowIntent()` | What a click on a notification or the tray menu asked for, once; `null` when none waits. A call: `{dialog: 'new-recording', app}` or `{dialog: 'stop-recording'}` (see [Live Recording → Calls](live-recording.md#calls-starting-and-ending)); a transcription: `{open: 'recording', transcriptId}`, `{open: 'job', jobId}` or `{open: 'alignment-model', language}` (see [Tray and quitting](#tray-and-quitting)). Only the window's own page gets it |
| `onWindowIntent(callback)` | Calls back when an intent waits for the window already open; returns what stops listening |
| `getMicApps()` | The apps that held a microphone long enough to suggest a recording, `{id, name}`, from `micApps` in `app-state.json` |
| `getNotificationRefusal()` | The last notification the system did not show, `{title, error}`, from `notificationRefusal` in `app-state.json`; `null` once one shows again (see [Tray and quitting](#tray-and-quitting)) |
| `onNotificationRefusal(callback)` | Calls back when that changes; returns what stops listening |

---

## Settings

Settings are stored in `app.getPath('userData')/settings.json` — `sonorus` in the OS app data folder for the installed app, `sonorus-dev` in dev mode, or the `--user-data-dir` given (see [Configuration](../../environment/configuration.md#sonorus_data_dir)). The main process reads this file before spawning the backend to extract `hfToken`, so a changed token reaches the transcription pipeline only after an app restart. It reads `theme` from it too, before the window exists, and sets `nativeTheme.themeSource`, so the window opens in the saved theme; anything but `system`, `light` or `dark` counts as `system`. The start mode of the queue is not here: the backend stores it (`PUT /queue/settings`).

Default values are `DEFAULT_SETTINGS` in `main.js` (used when `settings.json` is missing) and the same `DEFAULT_SETTINGS` in `ui/src/platform/settings.ts`, which fill in what a file lacks; a build test compares them. A file written by an older version may hold fields no longer used (`recordingUseMic`, `recordingDiarize`, `recordingSaveAudio`); they are read and written along and change nothing.

The UI reads and writes the file only through `settingsStore()` in `ui/src/platform/settings.ts`. `patch(change)` shows the change at once and queues the write: each write reads the file again and puts only its change on top, one after another, so that no field is lost to a second writer. `useSettings()` re-renders on every change. The saved `scale` applies with `setZoom` on start (`applySavedScale()` in `main.tsx`). Without Electron, in Storybook and tests, the settings start from the defaults and stay in memory. The Settings dialog and what each section changes: [Settings](settings.md).

---

## Dropping files on Linux

Drops need the window to run as a native Wayland app in a Wayland session (Electron 38+ default). Under XWayland a file dragged from a Wayland file manager arrives with an empty `dataTransfer` (no `Files`, no paths), so nothing could be imported. What a drop does: [Home](home.md).

---

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Only `electronAPI.*` methods are exposed to the page
- The CSP of `ui/index.html` (see [What the window loads](#what-the-window-loads))
- CORS in FastAPI is restricted to `null`, `127.0.0.1`, `localhost`, plus `SONORUS_DEV_UI_ORIGIN` in development
- Media permissions granted only for `permission === 'media'` (microphone)
- `will-navigate` is cancelled for the main window: the page never navigates itself, so a file dropped outside a drop zone does not replace the app
- Spell checking off (`spellcheck: false`, session spell checker disabled with no languages): Chromium downloads no dictionaries from Google — see [Privacy](../../privacy.md)
