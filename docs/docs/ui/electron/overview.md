---
sidebar_position: 1
---

# Electron UI

Cross-platform desktop interface built with Electron + Vanilla JS. Communicates with the Python FastAPI server over HTTP and WebSocket.

## Running in dev mode

```bash
# Terminal 1 — Python backend
.venv/bin/uvicorn app.api.main:app --port 8000

# Terminal 2 — Electron
npm start
```

---

## File structure

```
electron/
  main.js          — BrowserWindow, IPC handlers (file dialog, settings R/W, zoom)
  preload.js       — contextBridge: exposes electronAPI.*
  renderer/
    index.html     — App shell: left sidebar + main panel
    style.css      — Design tokens, all component styles
    utils.js       — API_BASE, WS_BASE, speaker helpers, fmtTime, makeAvatar
    components.js  — makeDropdown (shared UI component)
    data.js        — LANGUAGES, MODELS (single source of truth)
    app.js         — appSettings, loadSettings/saveSettings, view router, sidebar
    views/
      new-recording-modal.js — Modal overlay for recording setup (opened by Record/+ buttons, or auto-opened on startup when no transcripts exist)
      import-view.js    — Legacy file-upload preflight (no longer rendered; pending removal)
      live-recording-view.js — Active recording: starting → recording → review → transcribe
      progress-view.js  — WebSocket progress display
      editor-view.js    — Transcript editor + speaker panel + player
      settings-view.js  — Settings screen
```

Script load order in `index.html`: `utils.js` → `components.js` → `data.js` → views → `app.js`.

---

## IPC bridge

`preload.js` exposes the following via `contextBridge` as `window.electronAPI`:

| Method | Description |
|---|---|
| `openFile()` | Native file-open dialog (audio/video filter) |
| `getFilePath(file)` | Resolve a dropped `File` object to a filesystem path |
| `readSettings()` | Read `settings.json` from project root |
| `writeSettings(data)` | Write `settings.json` to project root |
| `setZoom(factor)` | Call `webContents.setZoomFactor(factor)` on the main window |

---

## Settings persistence

User preferences are stored in `settings.json` at the project root (gitignored). The file is read/written exclusively through the IPC bridge — the renderer cannot access the filesystem directly.

Default values:

```json
{
  "scale": 100,
  "transcribeLang": "auto",
  "transcribeModel": "small",
  "exportFormat": "txt"
}
```

On startup, `loadSettings()` in `app.js` reads the file and applies `setZoom(scale / 100)` before the first render.

---

## Views

### Startup behavior

On startup, `_loadSidebar({ autoOpen: true })` fetches transcripts and speakers. If at least one transcript exists, the app navigates directly to the **Editor view** for the most recent transcript (`created_at DESC`). If no transcripts exist, an empty panel is shown and the **New Recording modal** opens automatically.

### New Recording modal

Opened by the **Record** button (titlebar), the **+** button (sidebar header), or automatically on startup when no transcripts exist. Also accepts files via drag-and-drop onto the modal.

- **Title** — pre-filled with current date/time (e.g. `2 Jun 01:11 Meeting`), shown in gray; turns dark on first edit. On drag-and-drop the filename is used as default title if the user hasn't typed anything.
- **Audio source** — Microphone / System audio / Both (default). Inactive device selector is disabled in place.
- **Device dropdowns** — populated async via `navigator.mediaDevices.enumerateDevices()`
- **Model + Language** — dropdowns reusing `makeDropdown` + `MODELS`/`LANGUAGES` from `data.js`; saved to `appSettings`
- **Toggles** — Diarize speakers, Save audio file (both on by default)
- **Footer** — "Import audio file" (native dialog → `POST /transcribe`) + "Start recording" (passes settings to `showLiveRecording`)
- **Drag & drop** — dropping an audio/video file onto the modal triggers immediate import; file path resolved via `window.electronAPI.getFilePath(file)`
- Closes only via the × button (not on backdrop click)

`appSettings` keys: `recordingAudioSource`, `recordingMicDevice`, `recordingSystemDevice`, `recordingDiarize`, `recordingSaveAudio`.

### Progress view

- Opens WebSocket `WS_BASE/ws/{job_id}` immediately
- Displays current pipeline step (Loading models / Transcribing / Identifying speakers / Building / Saving)
- Indeterminate progress bar animates during long operations
- Heartbeat events (`type: "heartbeat"`) are silently ignored
- On `type: "done"` → auto-navigates to Editor view after 600ms

### Titlebar

CSS grid layout: `300px (sidebar header) | auto (nav) | 1fr (search) | auto (utility buttons)`.

| Zone | Contents |
|---|---|
| Sidebar header | Aligns with left sidebar width (300px), background matches sidebar |
| Nav (`tb-nav`) | Back · Forward |
| Search (`tb-search`) | Centered in the `1fr` column via `justify-self: center`; `clamp(180px, 45%, 480px)` wide |
| Utility (`tb-right`) | Copy · Share · Record · Inspector toggle · Settings |

The search cannot overlap nav or utility buttons because each zone occupies a separate grid column.

Record button has a pulsing red dot (`@keyframes pulse-dot`: opacity + scale, 1.4s).

### Editor view

Three-panel layout (all panels are separate elevated cards):

```
[Left sidebar] [Focus panel] [Right panel]
```

**Focus panel header:**

Rendered from two sources: `GET /transcripts/{id}` (segments, language) and `meta` from the sidebar `_allRecordings` list (title, created_at, speakers).

| Element | Content |
|---|---|
| Date line | `created_at` formatted as `DD Mon  HH:MM` (24h), e.g. `31 May  16:30`; hidden if unavailable |
| Title | `meta.title` if present, else filename stem with `_`/`-` → spaces |
| Meta row | Speaker avatar circles (20px, up to 5) + "N speakers" + language (hidden if `"unknown"`) |
| Tags row | Source chip (file / live recording) + `+ tag` placeholder button |

Speaker avatars use `speakerPalette(spkId)` for recognized speakers; unrecognized speakers show `?` on a grey circle.

**Focus panel:**
- Header (date + title + meta + tags)
- Scrollable segment list (`.seg-list`)
- Audio player bar fixed at the bottom

**Segment rows:**

Each segment shows: timestamp · speaker avatar (16px circle with initials or `?`) + name · text.

On hover the segment card gets a subtle grey background (inset `3px 6px`, `border-radius: 8px` via `::before`). In edit mode the background becomes a light blue tint; the edit wrap itself has an opaque `--panel-bg` fill so it appears above the tint.

On hover, a card-style toolbar (`background: #fff`, border, shadow) appears absolutely positioned at the top-right corner of the row, overlaying the text. It does not reserve horizontal space when hidden.

| Button | Action |
|---|---|
| Play | Seeks audio to segment start and plays |
| Edit | Enters inline edit mode |
| Bookmark | Visual placeholder (not yet wired) |
| Copy | Copies segment text to clipboard |
| Delete | `DELETE /segments/{start}` → fade-out animation + reload |

**Edit mode** (Edit button only — clicking text does not trigger edit):
- `contenteditable` field replaces the text label
- Footer row: hint text left · **✓ confirm** button (accent, saves) · **✕ cancel** button (grey) right
- **⌘↵** saves → `PATCH …/text`
- **Esc** or losing focus (blur) cancels — clicking outside the edit area exits edit mode
- Confirm/cancel buttons use `mousedown + preventDefault` to avoid triggering blur before click

**Tooltips** are rendered as a singleton `div.seg-tooltip` appended to `document.body` with `position: fixed`, so they are never clipped by parent overflow. Style: `var(--ink)` background, `border-radius: 7px`, box-shadow, rotated-square arrow — matches the selection toolbar.

**Selection toolbar:**

Appears above selected text (`position: fixed`, viewport-relative coordinates) when the user selects text inside a segment in normal (non-edit) mode.

| Button | Action |
|---|---|
| Copy | Copies selected text to clipboard |
| Highlight | Placeholder — "Highlights coming in a future update" |

The toolbar is hidden when the selection is inside a `.seg-row--editing` element.

**Audio player bar:**

Fixed 76px bar at the bottom of the focus panel.

| Section | Contents |
|---|---|
| Center — controls | Prev speaker · Prev segment · **Play/Pause** · Next segment · Next speaker |
| Center — progress | Elapsed time · seek track · total time |
| Right | Volume icon · volume slider |

- Play/Pause button is accent-colored (42×42px pill)
- Seek track shows filled portion via CSS `--pct` custom property
- Audio loaded from `file://` + `transcript.audio_path`
- The `Audio` element is persistent across `buildEditor` rebuilds; old event listeners are cleaned up via `AbortController`
- Segment/speaker skip logic: prev/next author jumps by speaker boundary

**Right panel (Speakers tab):**

Two sections: **Recognized** and **Unrecognized** — normal-case labels with a count, no colored dots.

All speaker cards show:
- Avatar (28px) · name · segment count + duration (no dot separator)
- Duration bar (amber fill for unrecognized, speaker color for recognized)
- **Play** button + **Assign** button (recognized) always visible — not hover-only
- Action container: transparent background, `0.5px` border, `6px` radius

Unrecognized cards additionally show:
- Quote sample: large decorative `"` (Georgia, italic) + italic caption text
- AI suggestion strip: speaker color tint, confirm (✓) + reject (×) buttons; reject is white with thin border
- "Assign speaker" full-width outlined button

The **Assign** button opens a speaker picker popup:

- `position: fixed`, 260px wide — not clipped by any parent
- Search field in a grey pill with magnifier icon + clear button
- List includes current speaker (shown with blue checkmark, always sorted first when not filtering)
- Keyboard navigation: `↑`/`↓` move focus, `Enter` selects, `Esc` closes
- "Add new speaker" button at the bottom shows the typed query in its label; clicking creates the speaker and reassigns via `POST /reassign` with `to_speaker_name`
- Selecting an existing speaker → `PATCH …/speaker` (single segment) or `POST /reassign` (bulk)

### Settings view

Scrollable single-column panel with five section cards:

| Section | Controls |
|---|---|
| Interface | App language dropdown, interface scale slider (50–200%, step 5) |
| ML Models | Transcription language, Whisper model list (with Download / Use / Delete), diarization model |
| Export | Format tiles (txt/md/srt/vtt/json), Duplicate toggle, Include toggles |
| Audio devices | Input and output device dropdowns |
| Reset | Two-step confirm flow (Reset… → Cancel + Confirm reset) |

**Interface scale** is applied via `setZoomFactor` (not CSS zoom) so layout proportions are preserved at all zoom levels. Zoom is applied on mouse-up (not while dragging) and persisted to `settings.json`.

---

## Left sidebar

| Element | Description |
|---|---|
| Workspace header | Logo + app name + **+** import button |
| Search | Client-side filter on the recordings list |
| Nav items | All recordings / Speakers / Bookmarks (counts from API) |
| Recordings list | Grouped by Today / Yesterday / Last week; title + speaker avatars + duration |
| Footer | WhisperX · GPU status dot + settings gear |

Active recording is highlighted with an accent stripe on the left.

---

## Speaker colors

Stable color per speaker ID — derived by hashing the ID modulo a 5-color palette. Defined in `utils.js`:

```javascript
const SPEAKER_PALETTE = [
  { color: '#5B8A72', bg: '#E6EDE7' },  // teal-green
  { color: '#C56E5A', bg: '#F4E5DF' },  // rose
  { color: '#5670A6', bg: '#E4E8F1' },  // blue
  { color: '#B58A3A', bg: '#F0E7D3' },  // amber
  { color: '#7B6DB5', bg: '#EBE9F4' },  // purple
]
```

Unrecognized speakers (`SPEAKER_` or `spk_` prefix) get a soft amber avatar background with a `?` glyph.

---

## UI scale

The base CSS values in `style.css` are ×1.05 relative to the original design (baked in, not applied at runtime). The user can further adjust the scale via the Settings slider (50–200%). Runtime scale is applied via Electron's `setZoomFactor` API.

---

## Security

- `contextIsolation: true`, `nodeIntegration: false`
- All Node.js access goes through the IPC bridge in `preload.js`
- `fetch()` and `WebSocket` are used directly in the renderer (no Node.js access)
- Content Security Policy: `connect-src http://localhost:8000 ws://localhost:8000`
