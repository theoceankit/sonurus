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

The window has no system frame (`electron/window-chrome.js`). The system's window buttons stay and stand over the page, in the colours of the light theme. Which side they are on depends on the system and the desktop, so `Titlebar` reads the free area from `env(titlebar-area-*)` and keeps its controls clear of it. The window is dragged by the free parts of the title bar: the strip has `-webkit-app-region: drag`, its buttons and the search field `no-drag`.

The system draws the strip of the window buttons over the page, so a modal's scrim does not reach it. While a modal is open, the window dims the strip itself to the colour of the page under the scrim (`--color-scrim` over `--color-bg-sunken`, and over `--color-text-primary` for the symbols), in 200 ms on the enter curve and back in 150 ms on the exit curve, as the scrim does. `Modal` holds the dim through `holdWindowDim()` in `ui/src/platform/window-dim.ts`, which sends `setWindowDimmed` of the preload only when the first modal opens and the last one closes, after the changes of one render: a window that takes over from another keeps the strip dimmed, and a preview does not dim it. With the change it sends the time of the next animation frame, when the scrim starts to move. In the main process `overlayDimmer()` of `electron/window-chrome.js` moves the colours with `setTitleBarOverlay` about every 16 ms, counting from that time rather than from when the message arrived (at most 50 ms back), so the strip keeps pace with the scrim; it starts from wherever the strip is, so closing halfway does not jump; a build test keeps its colours, durations and curves equal to the tokens. A page that loads again starts undimmed. macOS draws its own window buttons with no strip, so they stay as they are there.

`ui/src/screens/Editor/EditorScreen.tsx` lays out the window: `Titlebar`, `Sidebar`, and the transcript, inspector and player panels. The transcript panel shows `TranscriptPanel` ([Transcript](transcript.md)), the inspector `InspectorPanel` ([Inspector](inspector.md)) and the player panel `EditorPlayer` ([Player](player.md)); the screen holds the playback they follow. With no recording open the centre shows the empty state ([Home](home.md)). The Speakers button of the titlebar opens the Speakers window ([Speakers](speakers.md)), the Settings button the Settings dialog ([Settings](settings.md)).

| Window width | Side panels |
|---|---|
| 1112 and more | Both; the centre takes what is left, at least 480 |
| Below 1112 | One. The sidebar stays and the inspector goes; opening either one hides the other |

The width is that of the screen, so a story can show any size. A panel the user closed stays closed when the window widens; one hidden for lack of room comes back. While the inspector is hidden, a button next to Settings opens it. What is open is not remembered between runs. The rules are pure functions in `panels.ts`. A panel moves on its button and not when the window is resized: see [Motion](foundations.md#motion).

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
   `HF_TOKEN`, `SONORUS_DATA_DIR`, `LOG_FILE`, `SONORUS_VERSION`; packaged builds also put the bundled
   `ffmpeg` first on `PATH`.
3. `waitForReady()` — polls `/health` up to 60s, logs `[backend] ready in N ms`, then `main.js` opens the window.
4. `stopBackend()` — kills the process on `will-quit`.

There is no first-run setup: every launch, packaged or dev, goes straight to the window.

---

## File structure

```
electron/
  main.js              — BrowserWindow, IPC handlers, backend lifecycle orchestration
  backend.js           — Backend process spawn, health check, restart
  backend-identity.js  — Dev and packaged data dirs; whether a running backend may be reused
  dialog-folder.js     — Folder the file dialog opens in (last picked file, dialog-state.json)
  gpu-pack.js          — The GPU pack: applying downloads and removals, its check at start
  ui-entry.js          — What the window loads: the build or the dev server
  window-chrome.js     — Frameless window, window buttons and their dimming
  preload.js           — contextBridge: exposes electronAPI.*
  assets/
    icon.png           — app icon master for Windows and Linux, 1024×1024 (see Packaging → Icons)
    icon-macos.png     — app icon master for macOS, 1024×1024
    logo.png           — transparent S logo
ui/
  index.html           — the page and its CSP
  src/main.tsx         — entry: settings, saved scale, providers, App
  src/App.tsx          — the window: Editor screen, toasts, queue and recording providers
  src/screens/         — Editor, Home, Queue, Settings, Speakers
  src/components/      — one folder per component, with its stories
  src/api/             — the API client, its generated types and fixtures
  src/platform/        — the preload bridge, settings.json, window dimming
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
| `writeClipboard(text)` | Write text to the system clipboard |
| `restartBackend()` | Restart the backend to apply a GPU download or removal (asked once `POST /gpu/restart` says `ready`); resolves when the new backend is up. See [GPU acceleration](./gpu-acceleration.md) |
| `setWindowDimmed(dimmed, startedAt)` | Dim or undim the strip of the window buttons with a modal's scrim (see [Window and Editor shell](#window-and-editor-shell)) |
| `getPlatform()` | Returns `process.platform` (`'win32'`, `'darwin'`, `'linux'`) |
| `getAppVersion()` | Returns `app.getVersion()` — the `version` field of `package.json` |

---

## Settings

Settings are stored in `app.getPath('userData')/settings.json` — `sonorus` in the OS app data folder for the installed app, `sonorus-dev` in dev mode, or the `--user-data-dir` given (see [Configuration](../../environment/configuration.md#sonorus_data_dir)). The main process reads this file before spawning the backend to extract `hfToken`, so a changed token reaches the transcription pipeline only after an app restart. The start mode of the queue is not here: the backend stores it (`PUT /queue/settings`).

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
