---
sidebar_position: 4
---

# Unimplemented controls

A control whose feature does not exist yet is not hidden and does not pretend to work. It stays
visible, **dimmed and clickable**; a click only shows the toast **"Not available yet"** and never
reaches the control's own handlers, so its state, the active tab or filter and the saved settings
do not change.

This is different from a disabled control: a disabled control uses the default cursor and ignores
the click (for example **Start recording** while a recording is running). An unimplemented control
has the help cursor and answers with the toast.

## Usage

Everything lives in `electron/renderer/not-implemented.js`, loaded right after `utils.js`:

- `NOT_IMPLEMENTED` — the registry: one id per unimplemented control, with a comment saying which
  control it is. It is the list of what the UI shows but the app does not do yet.
- `markNotImplemented(el, id)` — marks `el` where it is built: `data-not-implemented="<id>"`, the
  class `not-implemented` and `aria-disabled="true"`. An id that is not in the registry leaves the
  element alone. Returns `el`.
- `installNotImplementedGuard(document)` — called once by `app.init()`. A `click` listener in the
  capture phase runs `notImplementedClick()`: a click on a marked element, or anywhere inside a
  marked container, gets `preventDefault()` + `stopImmediatePropagation()` and the toast. Because
  it runs before the control's own listeners and before delegated listeners on its parents, the
  control's code needs no changes. Enter or Space on a focused button fires `click` too.
- `NOT_IMPLEMENTED_TOAST` — the toast text, the only place it is written.

The look is in `styles/base.css`: `.not-implemented` has `opacity: 0.45` and the help cursor on
the element and everything inside it.

The guard only intercepts `click`. A control that acts on `mousedown`, `pointerdown` or keyboard
events of its own is not covered and needs its handler skipped explicitly.

## Marked controls

| Id | Control | Marked in |
|---|---|---|
| `recording.diarize` | New recording modal → **Diarize speakers** toggle | `new-recording-modal.js` |
| `recording.save-audio` | New recording modal → **Save audio file** toggle | `new-recording-modal.js` |
| `settings.export` | Settings → **Export**, the whole section (format, duplicate, include toggles) | `settings-view.js` |
| `settings.app-language` | Settings → Interface → **App language** | `settings-view.js` |
| `settings.include-mic` | Settings → Audio devices → **Include microphone** | `settings-view.js` |
| `sidebar.filter-notes` | Sidebar → **Notes** filter chip | `app.js` |
| `sidebar.filter-marked` | Sidebar → **Marked** filter chip | `app.js` |
| `titlebar.search` | Titlebar → **Search transcripts…** | `app.js` |
| `titlebar.share` | Titlebar → **Share** | `app.js` |
| `editor.tab-chapters` | Editor right panel → **Chapters** tab | `editor/right-panel.js` |
| `editor.tab-notes` | Editor right panel → **Notes** tab | `editor/right-panel.js` |
| `editor.tab-activity` | Editor right panel → **Activity** tab | `editor/right-panel.js` |
| `editor.add-tag` | Editor header → **+ tag** | `editor-view.js` |
| `editor.highlight` | Editor selection toolbar → **Highlight** | `editor-view.js` |
| `segment.bookmark` | Segment row → **Bookmark** | `editor/segment-row.js` |

Values these controls already wrote to `settings.json` (`recordingDiarize`, `recordingSaveAudio`,
`recordingUseMic`, `exportFormat`) are kept as they are.

## When a feature lands

Remove its id from `NOT_IMPLEMENTED` and the `markNotImplemented()` call at its control, then
connect the control as usual. Remove the row above too.

## Test

`tests/renderer/not-implemented.test.js` checks the registry against the expected list, the
marking and the click guard, and scans the renderer sources: every registered id is used at exactly
one call site, no call site uses an id outside the registry (so the registry and the call sites are
always removed together), and no ad-hoc "not available" / "coming in a future update" toast is left.
