---
sidebar_position: 2
---

# Icons

Every icon in the Electron UI is a file in `electron/assets/icons/<name>.svg`. The renderer contains
no inline SVG icons.

## Usage

- **JS:** `icon('delete', 14)` (`electron/renderer/icons.js`) returns a `<span class="icon">` with a
  square 14 px box.
- **Static HTML** (`index.html`, `setup.html`): `<span data-icon="search" data-size="13"></span>`;
  `icons.js` fills these in when it loads, keeping any inline style of the placeholder (e.g. a color).

## Rendering

The file is a CSS mask (`mask: url(...) center / contain`) over `background-color: currentColor`,
so an icon takes the text color of its parent and the colors inside the file are ignored.
Icons are therefore single-color. Styles are inline, not in a stylesheet: the CSP of `setup.html`
allows inline styles only.

## Replacing and adding an icon

- **Replace:** overwrite `<name>.svg` with the new drawing and reload the app — nothing else changes.
- **Add:** drop `<name>.svg` into the folder, reference it by name from the renderer and add a row
  to the table below.

## Rules for a file

- **Name:** kebab-case, by meaning (`delete`, `next-speaker`), not by look or source (`trash-2`, `mdi-…`).
- **Root element:** `<svg xmlns="http://www.w3.org/2000/svg" viewBox="…">` — both attributes are
  required (the file is loaded as an image, and the viewBox is what gets scaled).
- **One color:** only the shape (and its opacity) matters.
- **Square viewBox**, glyph centered: the UI places every icon in a square box (`size` px).
  Padding inside the viewBox makes the icon look smaller.
- `width` / `height` on the root are optional and ignored by the UI.

`tests/renderer/icons.test.js` fails when a name used in the renderer has no file, when a file breaks
the naming or root-element rules, or when inline SVG icons return.

## Where each icon is used

| Icon | Where it is used |
|---|---|
| `add` | New recording (sidebar), "Add new speaker…" in the speaker picker, off-state of export toggles |
| `alert` | Settings: model notes, "Reset to defaults" section |
| `alignment` | Settings: "Alignment Models" section |
| `api-keys` | Settings: "API Keys" section |
| `arrow-left` | Titlebar: Back |
| `arrow-right` | Setup: Install & Launch / Continue buttons |
| `assign-speaker` | Speaker card: assign an unrecognized speaker |
| `bookmark` | Segment row: Save for later |
| `check` | Checkmarks: dropdowns, speaker picker, toggles, confirm edit / suggestion, "Installed", setup steps |
| `chevron-down` | Dropdowns, speaker chip in a segment row |
| `chevron-right` | Setup: log toggle (rotated when open) |
| `close` | Close / cancel / reject / clear |
| `copy` | Titlebar: Copy to clipboard, selection toolbar, segment row |
| `delete` | Delete transcript / segment / model, "Delete all data" section |
| `download` | Download a model (settings, alignment prompt) |
| `edit` | Segment row: Edit |
| `export` | Settings: "Export" section |
| `eye` | Settings: show / hide token |
| `forward` | Player: forward 15 s |
| `highlight` | Selection toolbar: Highlight |
| `import` | New recording modal: import a file, drop overlays (modal and window) |
| `inspector` | Titlebar: toggle the right panel |
| `interface` | Settings: "Interface" section |
| `microphone` | Microphone source, "Audio devices" section, setup permission |
| `microphone-and-system` | New recording modal: "Both" source |
| `models` | Settings: "ML Models" section |
| `next-speaker` | Player: next speaker |
| `pause` | Player, speaker card preview, speaker voice sample, transcription queue: Pause |
| `play` | Player, speaker card preview, speaker voice sample, transcription queue: Start |
| `play-outline` | Segment row: Play segment |
| `prev-speaker` | Player: previous speaker |
| `privacy` | Setup: privacy note |
| `reassign-speaker` | Speaker card: reassign |
| `retry` | Alignment prompt: Retry transcription; failed job card: Retry |
| `rewind` | Player: back 15 s |
| `search` | Titlebar search, speaker search, speaker picker |
| `settings` | Titlebar: Settings |
| `share` | Titlebar: Share |
| `speakers` | Settings: diarization model |
| `system-audio` | New recording modal: system audio source, setup permission |
| `volume` | Player: volume |
| `waveform` | Settings: Whisper model |
