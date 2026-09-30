---
sidebar_position: 3
---

# Speaker avatar

Every speaker avatar in the Electron UI — a colored circle with the speaker's initials, or a grey
`?` for an unrecognized speaker — comes from the helpers in `electron/renderer/utils.js`. No view
builds one by hand.

## Usage

- `makeAvatar(spkId, displayName, size = 'md', knownMap = {})` — the avatar of a speaker. A
  recognized speaker (a display name in `knownMap`) gets the initials of `displayName` on its palette
  color (`speakerPalette()`); anyone else gets `?` (`spk-avatar--unknown`).
- `makeNameAvatar(name, color, size = 'md')` — an avatar for a name that has no speaker id yet (the
  preview in the New speaker dialog). An empty name gives a circle without letters.
- `setAvatarName(el, name, color)` — updates the initials and color of an existing avatar in place
  (the New speaker preview as the name is typed and a swatch is picked).
- `makeAvatarStack(spkIds, size, knownMap, { max, nameOf, titles })` — overlapping avatars; the
  first one is on top. `nameOf(spkId)` gives the name for the initials, `titles: true` also puts it in
  a hover tooltip.

The element is `<div class="spk-avatar spk-avatar--<size>">`; only the palette color is set inline.

## Sizes

A size is one of four presets. Circle and font live in CSS (`.spk-avatar--<size>` in `editor.css`);
a value outside the presets throws.

| Size | Circle / font | Where it is used |
|---|---|---|
| `xs` | 16 / 7 px | Sidebar transcript row (stack of up to 3), segment row |
| `sm` | 20 / 9 px | Editor header (stack of up to 5, with tooltips), speaker picker |
| `md` | 28 / 11 px | Speaker cards in the editor's right panel, Speakers list, New speaker dialog |
| `lg` | 52 / 20 px | Speaker page header |

Small presets have a relatively larger font on purpose: two letters must stay readable on 16 px.

## Look and behavior

- **Unrecognized speaker:** the same opaque light grey with a dim `?` everywhere, no border. Opaque so
  that in a stack it does not show the avatar under it.
- **Stack:** avatars overlap by 5 px and have a 1.5 px ring in the color of `--avatar-ring`, which the
  container sets to its own background (`--sidebar-bg` in a sidebar row, `#0A84FF` in the active row;
  `--panel-bg` by default).
- **Not selectable:** `user-select: none`, so the initials are never selected by a drag or a
  double-click and never copied with the text around them. The cursor is not set: Chromium shows
  the arrow over non-selectable text, and inside a button the button's pointer is kept.

## Tests

`tests/renderer/avatar.test.js` covers the helpers and fails when `speakerInitials()` is called
outside `utils.js` (an avatar built by hand), when one of the old per-place avatar classes comes
back, when `.spk-avatar` loses `user-select: none`, or when a size preset has no CSS rule.
