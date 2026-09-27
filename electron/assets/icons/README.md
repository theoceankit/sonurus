# UI icons

Every icon in the Electron UI is a file in this folder. The renderer never inlines SVG markup:
JS calls `icon('name', size)` (`electron/renderer/icons.js`), static HTML writes
`<span data-icon="name" data-size="14"></span>`.

## Replacing an icon

Overwrite `<name>.svg` with the new drawing — nothing else changes. Reload the app to see it.

## Adding an icon

Drop `<name>.svg` here, then reference it by name from the renderer and add a row to the table below.

## Rules for a file

- **Name:** kebab-case, by meaning (`delete`, `next-speaker`), not by look or source (`trash-2`, `mdi-…`).
- **Root element:** `<svg xmlns="http://www.w3.org/2000/svg" viewBox="…">` — both attributes are required
  (the file is loaded as an image, and the viewBox is what gets scaled).
- **One color:** the file is used as a mask and filled with the text color of the surrounding UI,
  so colors inside the file are ignored — only the shape (and its opacity) matters.
- **Square viewBox**, glyph centered: the UI places every icon in a square box (`size` px).
  Padding inside the viewBox makes the icon look smaller.
- `width` / `height` on the root are optional and ignored by the UI.

`tests/renderer/icons.test.js` checks that every name used in the renderer has a file, that every file
follows the rules above and is listed here, and that no inline SVG icons come back.

## Icons

| Icon | Where it is used |
|---|---|
| `add` | New recording (sidebar), new speaker in the speaker picker, off-state of export toggles |
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
| `import` | New recording modal: import a file, drop overlay |
| `inspector` | Titlebar: toggle the right panel |
| `interface` | Settings: "Interface" section |
| `microphone` | Microphone source, "Audio devices" section, setup permission |
| `microphone-and-system` | New recording modal: "Both" source |
| `models` | Settings: "ML Models" section |
| `next-speaker` | Player: next speaker |
| `pause` | Player, speaker card preview, speaker voice sample |
| `play` | Player, speaker card preview, speaker voice sample |
| `play-outline` | Segment row: Play segment |
| `prev-speaker` | Player: previous speaker |
| `privacy` | Setup: privacy note |
| `reassign-speaker` | Speaker card: reassign |
| `retry` | Alignment prompt: Retry transcription |
| `rewind` | Player: back 15 s |
| `search` | Titlebar search, speaker search, speaker picker |
| `settings` | Titlebar: Settings |
| `share` | Titlebar: Share |
| `speakers` | Settings: diarization model |
| `system-audio` | New recording modal: system audio source, setup permission |
| `volume` | Player: volume |
| `waveform` | Settings: Whisper model |
