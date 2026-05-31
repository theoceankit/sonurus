---
sidebar_position: 5
---

# UI Redesign

Staged migration of the Electron UI from the current lavender/card design to a macOS-native flat design based on the reference mockup at `redesign/[redesign] Transcription Screen.html`.

Branch: `redesign/ui`

---

## Design reference

The reference mockup is a self-contained React + Babel bundle (`redesign/[redesign] Transcription Screen.html`). The decompressed app code is ~2300 lines of JSX. Key design decisions extracted from it:

### Color system

| Token | Old | New |
|---|---|---|
| `--ink` | `#19182A` (purple-dark) | `#1D1D1F` (macOS primary) |
| `--ink-dim` | `#6D6A7C` | `#86868B` (macOS tertiary) |
| `--accent` | `#5A57F2` (purple) | `#0A84FF` (system blue) |
| `--accent-bg` | `#EEEEFF` | `rgba(10,132,255,0.10)` |
| `--bg` | `#EDE9F4` (lavender) | `#FFFFFF` |
| `--sidebar-bg` | `#FAF8FC` | `#F5F5F7` (macOS sidebar) |
| `--border` | `rgba(40,30,80,0.08)` | `rgba(0,0,0,0.08)` |
| window chrome | floating cards with gap | flush panels, macOS titlebar |

Additional tokens added: `--ink-2` (#3A3A3C), `--ink-3` (#86868B), `--ink-4` (#AEAEB2), `--mono`.

### Layout

Old: `#app` has `padding: 10.5px; gap: 10.5px` — sidebar and main panel are floating cards.

New: `#app` has `padding: 0; gap: 0` — all panels are flush, the window itself is the container.

### Window structure (target)

```
┌─────────────────────────────────────────────────────────┐
│ Titlebar (38px)                                          │
│  [traffic lights][toggle]  [search bar]  [actions][rec] │
├──────────┬──────────────────────────────┬───────────────┤
│ Sidebar  │ Detail / main panel          │ Inspector     │
│ (300px)  │                              │ (268px)       │
│          │  h1 title (editable)         │               │
│ List     │  metadata strip              │ Speakers      │
│ filter   │  tags                        │ Chapters      │
│ chips    │  AI summary card             │ Notes         │
│          │  ──────────────              │ Activity      │
│ Grouped  │  segments stream             │               │
│ by date  │                              │               │
│          │                              │               │
├──────────┴──────────────────────────────┴───────────────┤
│ Player bar (64px) — waveform + controls                  │
└─────────────────────────────────────────────────────────┘
```

### Segment row (target)

```
grid: 58px | 1fr | 56px
│  00:04  │ • Alex Rivera               [bk] [···] │
│         │ Alright, let's get going…              │
│  ──     │                                        │
│  (prog) │                                        │
```

- Left border: 2px solid `#0A84FF` when playing, transparent otherwise
- Timestamp: clickable → seek; micro progress bar below when playing
- Speaker: 7px colored dot + colored name (no avatar circle)
- Hover actions: only Bookmark + ⋯ More (2 buttons, no pill bar)
- Edit mode: blue `box-shadow: 0 0 0 3px rgba(10,132,255,0.10)`

### Player bar (target)

- 64px height (was 76px)
- Controls: Prev speaker · −15s · Play/Pause (32px dark circle) · +15s · Next speaker
- Center: waveform (220 bars, colored per speaker, bookmark triangles, hover scrubber)
- Right: duration + speed toggle (1× / 1.25× / 1.5× / 2×) + volume

### Sidebar (target)

- Header: "Transcripts" + count + Sort / New buttons (no logo — moved to titlebar)
- Source filter: segmented control chips (All / Recordings / Notes / Marked)
- Processing strip: in-progress transcription with progress bar (inside list)
- List items: title + time + duration + bookmark icon + stacked speaker avatars
- Footer: user avatar + name + WhisperX · GPU status + settings gear

### Inspector (target)

Four tabs replacing the single Speakers tab:

| Tab | Content |
|---|---|
| Speakers | Recognized (duration bars) + Unrecognized cards (AI suggestion strip, quote snippet, confirm/reject) |
| Chapters | AI-generated topic chapters (timestamp + duration + segment count) |
| Notes | Segment-linked notes with quote preview |
| Activity | Recent activity feed (reassign/bookmark/comment events) |

---

## Phases

### Phase 1 — Design tokens + global layout ✅ Done

**Scope:** CSS only, no HTML or JS changes.

**Changes made:**
- Updated all CSS custom properties (`--ink`, `--accent`, `--border`, etc.)
- Added `--ink-2/3/4`, `--mono` tokens
- Changed `body` background to `#CFD2DA` (neutral gray)
- Removed `padding`/`gap` from `#app` — panels are now flush
- `#sidebar`: removed card (`border-radius`, `border`, `box-shadow`), added `border-right: 0.5px`, width `281px → 300px`
- `#main-panel`: removed card styles
- `#main-panel.main-panel--editor`: removed `overflow: visible`
- `.editor-layout`: removed `gap: 10.5px`
- `.focus-panel`: removed card styles
- `.right-panel`: removed card styles, added `border-left: 0.5px`
- `.sb-logo`: removed purple gradient, simplified to flat `#1D1D1F`
- Mass-replaced all purple-tinted `rgba(40,30,80,…)`, `rgba(90,87,242,…)`, `rgba(25,24,42,…)` with neutral equivalents
- Replaced all purple hex values (`#5A57F2`, `#8E5BEF`, `#19182A`, `#6D6A7C`, `#EDE9F4`, `#FAF8FC`, etc.)
- Removed degenerate `linear-gradient`s that became same-color after replacement
- Updated accent shadows/glows from purple to blue throughout

---

### Phase 2 — Titlebar ✅ Done

**Scope:** `index.html` + `style.css` + `app.js`

**Changes:**
1. Add `<div id="titlebar">` above `#app` in `index.html`
2. Left section (300px, sidebar color): macOS traffic light dots (12px circles: `#FF5F57` / `#FEBC2E` / `#28C840`) + sidebar toggle button
3. Center section: search bar (380px wide, centered across full window width; connects to existing `#sb-search-input` or new find logic)
4. Right section: Back button (→ `app.showImport()`), Forward, separator, Share, Export, **Record** button (→ `app.showLiveRecording()`), separator, Toggle inspector button
5. CSS: 38px height, `border-bottom: 0.5px solid var(--border)`, left section has `background: var(--sidebar-bg)`, traffic lights use `display:flex; gap:8px`
6. Electron `main.js`: set `titleBarStyle: 'hidden'` or `frame: false` + `titleBarOverlay` if needed for native titlebar removal

---

### Phase 3 — Sidebar redesign ✅ Done

**Scope:** `index.html` + `style.css` + `app.js`

**Changes:**
1. Replace `.sb-nav` (All recordings / Speakers / Bookmarks) with segmented filter control: **All / Recordings / Notes / Marked**
2. Redesign `.sb-header`: replace logo+workspace with "Transcripts" heading + item count + Sort / New icon buttons
3. Redesign `.rec-item`: active state = `background: #0A84FF; color: #fff` (no more white card + accent stripe)
4. Redesign `.sb-footer`: add user avatar (initials circle) + user name + existing GPU status dot + settings gear
5. Add processing strip: when a transcription is running, show it at top of list with title + stage + percent + progress bar (reuse WebSocket state from `showProgress`)

---

### Phase 4 — Segment row redesign ✅ Done

**Scope:** `editor-view.js` + `style.css`

**Changes:**
1. Change `.seg-row` grid from `55px 1fr` to `58px 1fr 56px` (add actions column)
2. Add left `border-left: 2px` (blue when playing, transparent otherwise); remove `border-radius` and hover background
3. Time column (`.seg-time`): becomes a `<button>` — click → seek audio; add micro progress bar (`height: 2px`) below timestamp when segment is playing
4. Speaker header: remove avatar circle (`.spk-avatar`); add 7px colored dot + colored speaker name (`color: spk.color`); show chevron on hover
5. Text: reduce `font-size: 15px → 14px`, `line-height: 1.55 → 1.6`
6. Edit mode: remove amber background on `.seg-row--editing`; edit box gets `border: 1px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-bg)`; hint text `⌘↵ to save · esc to cancel` inline below edit area (no Save/Cancel buttons)
7. Hover actions (`.seg-actions`): keep only Bookmark + ⋯ More; remove pill border/background — plain buttons with `opacity: 0 → 1` on hover
8. Speaker break gap: add `margin-top: 6px` when consecutive segments change speaker

---

### Phase 5 — Player bar redesign ✅ Done

**Scope:** `editor-view.js` + `style.css`

**Changes:**
1. Height `76px → 64px`
2. Replace `.player-track` (CSS seek bar) with Waveform component:
   - 220 `<div>` bars generated from seeded pseudo-random heights
   - Bar colors: look up which segment owns each bar's timestamp → use `speakerPalette(spk).color`
   - Filled bars at full opacity; unfilled bars at 0.32 opacity
   - Click/drag → seek
   - Hover: show scrubber line + floating timestamp tooltip
   - Bookmark markers: amber triangle above bar at bookmarked segment timestamps (Phase 6 data)
3. Controls rearrangement: remove separate `.player-side` left/right layout; use single flex row
   - Order: Prev speaker · −15s · Play/Pause · +15s · Next speaker · elapsed · [waveform] · total · speed · volume
4. Play/Pause button: `width: 32px; height: 32px; border-radius: 50%; background: var(--ink); color: #fff` (dark, no accent color)
5. Speed toggle: cycling button `1× → 1.25× → 1.5× → 2×` replacing volume slider position
6. Volume: icon-only button (no slider visible by default)

---

### Phase 6 — Inspector tabs redesign ✅ Done

**Scope:** `editor-view.js` + `style.css`

**Changes:**
1. Add three new tabs alongside Speakers: **Chapters / Notes / Activity**
2. Tab bar: segmented control style (same as sidebar filter chips)
3. **Chapters tab**: static initially; show list of segments grouped by topic (first implementation: show speaker turns as pseudo-chapters — timestamp + speaker name + first 60 chars of text)
4. **Notes tab**: show bookmarked segments (reuse existing bookmark data); each entry shows speaker + timestamp + text excerpt
5. **Activity tab**: static placeholder feed ("Coming soon")
6. **Speakers tab** improvements:
   - Unrecognized speaker cards: add quote snippet (first 80 chars of the speaker's text)
   - Add AI suggestion strip when similarity score ≥ 60%: colored dot + "Likely {name}" + score% + Confirm ✓ / Reject ✗ buttons
   - Confirm → calls existing `POST /reassign` bulk endpoint

---

### Phase 7 — New components ✅ Done

**Scope:** `electron/renderer/views/editor-view.js` + `electron/renderer/style.css` + `electron/renderer/app.js`

**Implemented:** 7b Toast queue, 7e Tags, 7d Selection toolbar.

---

#### 7b. Toast queue

**File:** `app.js` + `style.css`

**Spec:**

A global singleton toast system. Toasts appear bottom-right, stack vertically, auto-dismiss after 3.2s.

**Add to `app.js`** (module scope, initialized in `app.init()`):

```javascript
// Toast container — appended to body once
const _toastStack = document.createElement('div')
_toastStack.id = 'toast-stack'
document.body.appendChild(_toastStack)

window.showToast = function(text, opts = {}) {
  const { actionLabel, action, duration = 3200 } = opts
  const toast = document.createElement('div')
  toast.className = 'toast'

  const msg = document.createElement('span')
  msg.className = 'toast-text'
  msg.textContent = text
  toast.appendChild(msg)

  if (actionLabel) {
    const btn = document.createElement('button')
    btn.className = 'toast-action'
    btn.textContent = actionLabel
    btn.addEventListener('click', () => { action?.(); dismiss() })
    toast.appendChild(btn)
  }

  const closeBtn = document.createElement('button')
  closeBtn.className = 'toast-close'
  closeBtn.innerHTML = '✕'
  closeBtn.addEventListener('click', dismiss)
  toast.appendChild(closeBtn)

  _toastStack.appendChild(toast)

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast--visible'))

  let timer = setTimeout(dismiss, duration)

  function dismiss() {
    clearTimeout(timer)
    toast.classList.remove('toast--visible')
    toast.classList.add('toast--out')
    setTimeout(() => toast.remove(), 220)
  }

  return { dismiss }
}
```

**CSS:**
```css
#toast-stack {
  position: fixed;
  right: 20px;
  bottom: 84px;   /* above player bar (64px) + margin */
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px 9px 14px;
  background: var(--ink);
  color: #fff;
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.08);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  max-width: 340px;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.18s, transform 0.18s;
}
.toast--visible  { opacity: 1; transform: translateY(0); }
.toast--out      { opacity: 0; transform: translateY(4px); }

.toast-text  { flex: 1; min-width: 0; }
.toast-action {
  border: none; background: transparent; color: #7AB4FF;
  cursor: pointer; font-size: 12px; font-weight: 600; padding: 0 0 0 4px;
  font-family: inherit;
}
.toast-close {
  border: none; background: transparent; color: rgba(255,255,255,0.5);
  cursor: pointer; font-size: 12px; padding: 0; font-family: inherit; flex-shrink: 0;
}
```

**Usage example** (segment copied):
```javascript
// In moreBtn menu inside makeSegmentRow:
navigator.clipboard.writeText(seg.text).then(() => {
  window.showToast?.('Copied to clipboard')
})
```

**Also:** connect the error banner in `import-view.js` to toasts — optionally, or leave as-is (the banner works well in the import flow context).

---

#### 7d. Selection toolbar

**File:** `editor-view.js` + `style.css`

**Spec:**

A floating dark pill that appears above any text selection made inside the segment stream. Positioned relative to `focusPanel`.

```
        ╔═══════════════════════════════════╗
        ║  □ Copy  |  " Quote  |  ✏ Edit  ║
        ╚═══════════════════════════════════╝
              ▼
   [selected text in segment]
```

**DOM setup** (in `buildEditor`):

Mark the segment list container for detection:
```javascript
segList.dataset.stream = 'true'
```

Mark the focus panel for positioning:
```javascript
focusPanel.dataset.mainpane = 'true'
```

Create toolbar element (one singleton per editor instance):
```javascript
const selToolbar = document.createElement('div')
selToolbar.className = 'sel-toolbar'
selToolbar.style.display = 'none'
focusPanel.appendChild(selToolbar)
// focusPanel must have position: relative (already set via CSS)
```

**Event wiring:**
```javascript
document.addEventListener('mouseup', onMouseUp, { signal: playerAbortCtrl.signal })
document.addEventListener('selectionchange', onSelectionChange, { signal: playerAbortCtrl.signal })
```

```javascript
function onMouseUp() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) { hideSelToolbar(); return }
  const anchor = sel.anchorNode
  if (!anchor) { hideSelToolbar(); return }
  const el = anchor.nodeType === 1 ? anchor : anchor.parentElement
  if (!el?.closest('[data-stream]')) { hideSelToolbar(); return }

  const range = sel.getRangeAt(0)
  const rRect  = range.getBoundingClientRect()
  const pRect  = focusPanel.getBoundingClientRect()
  if (rRect.width < 4) { hideSelToolbar(); return }

  // Position: centered above selection, relative to focusPanel
  selToolbar.style.display = 'inline-flex'
  const tbW = selToolbar.offsetWidth || 200
  const x = rRect.left + rRect.width / 2 - pRect.left - tbW / 2
  const y = rRect.top - pRect.top - selToolbar.offsetHeight - 10

  selToolbar.style.left = Math.max(8, Math.min(x, pRect.width - tbW - 8)) + 'px'
  selToolbar.style.top  = Math.max(8, y) + 'px'
}

function onSelectionChange() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) hideSelToolbar()
}

function hideSelToolbar() { selToolbar.style.display = 'none' }
```

**Toolbar buttons:**
```javascript
const SEL_ACTIONS = [
  {
    label: 'Copy',
    icon: `<svg ...>`, // copy icon
    action: () => {
      const text = window.getSelection()?.toString()
      if (text) navigator.clipboard.writeText(text).then(() => window.showToast?.('Copied'))
      hideSelToolbar()
    }
  },
  {
    label: 'Quote',
    icon: `<svg ...>`, // quote icon
    action: () => {
      const text = window.getSelection()?.toString()
      if (text) navigator.clipboard.writeText(`"${text}"`).then(() => window.showToast?.('Quote copied'))
      hideSelToolbar()
    }
  },
  {
    label: 'Edit',
    icon: `<svg ...>`, // edit icon
    action: () => {
      const sel = window.getSelection()
      const el = sel?.anchorNode?.parentElement?.closest('.seg-row')
      if (el) el.querySelector('.seg-text')?.click()  // triggers enterEditMode
      hideSelToolbar()
    }
  },
]
```

**CSS:**
```css
.sel-toolbar {
  position: absolute;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  gap: 1px;
  background: var(--ink);
  color: #fff;
  border-radius: 7px;
  box-shadow: 0 8px 22px rgba(0,0,0,0.22), 0 2px 4px rgba(0,0,0,0.10);
  pointer-events: auto;
  user-select: none;
}
.sel-toolbar::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  transform: translateX(-50%) rotate(45deg);
  width: 8px; height: 8px;
  background: var(--ink);
  border-radius: 1px;
}
.sel-action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; color: #fff;
  cursor: pointer; padding: 5px 9px; border-radius: 4px;
  font-size: 11.5px; font-weight: 500; font-family: inherit;
  transition: background 0.08s;
}
.sel-action-btn:hover { background: rgba(255,255,255,0.12); }

.sel-toolbar-sep {
  width: 1px; height: 14px;
  background: rgba(255,255,255,0.18);
  flex-shrink: 0;
}
```

---

#### 7e. Tags

**File:** `editor-view.js` + `style.css`

**Spec:**

A row of tag chips inserted into the `focus-topbar`, directly below the metadata row (`.focus-meta`). Tags come from the transcript object if available; for now the schema has no tags, so show a source-type tag derived from `transcript.audio_file` path.

**Where in `buildEditor`:**
```javascript
// After metaRow, inside topBar:
const tagsRow = makeTagsRow(transcript)
topBar.appendChild(tagsRow)
```

**Logic:**
```javascript
function makeTagsRow(transcript) {
  const row = document.createElement('div')
  row.className = 'focus-tags'

  // Source type tag: derive from audio path
  const audioPath = transcript.audio_path || ''
  const isLiveRec = audioPath.includes('whisper-rec-')
  const sourceTag = isLiveRec ? 'live-recording' : 'file'

  function makeTag(label, style = '') {
    const chip = document.createElement('span')
    chip.className = 'focus-tag'
    if (style) chip.style.cssText = style
    chip.textContent = label
    return chip
  }

  // Source type tag (auto, not editable)
  const srcChip = makeTag(sourceTag, `
    background: rgba(10,132,255,0.08);
    color: var(--accent);
    border: 0.5px solid rgba(10,132,255,0.20);
  `)
  row.appendChild(srcChip)

  // User tags (empty for now — future: from transcript.tags field)
  // transcript.tags?.forEach(t => row.appendChild(makeTag(t)))

  // "+ tag" stub button
  const addBtn = document.createElement('button')
  addBtn.className = 'focus-tag focus-tag--add'
  addBtn.textContent = '+ tag'
  addBtn.addEventListener('click', () => window.showToast?.('Tags coming in a future update'))
  row.appendChild(addBtn)

  return row
}
```

**CSS:**
```css
.focus-tags {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.focus-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 4px;
  background: rgba(0,0,0,0.05);
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  border: none;
  cursor: default;
}

.focus-tag--add {
  background: transparent;
  color: var(--ink-dim);
  border: 0.5px dashed var(--ink-4);
  cursor: pointer;
  transition: background 0.08s, color 0.08s;
}
.focus-tag--add:hover { background: rgba(0,0,0,0.04); color: var(--ink); }
```

---

## Files affected by phase

| File | Phases |
|---|---|
| `electron/renderer/style.css` | 1, 2, 3, 4, 5, 6, 7 |
| `electron/renderer/index.html` | 2, 3 |
| `electron/renderer/app.js` | 2, 3, 7b |
| `electron/renderer/views/editor-view.js` | 4, 5, 6, 7 |
| `electron/main.js` | 2 (titlebar frame) |

## Current branch state (after Phases 1–7 + post-release fixes)

Branch: `redesign/ui`.

### Post-release fixes (2026-05-31)

**Window frame**
- Native OS frame — `titleBarStyle: 'hidden'` removed; traffic light buttons, IPC window controls, and preload APIs removed.

**Titlebar**
- "Toggle sidebar" button removed; `toggleSidebar()` method removed.
- Settings gear moved from sidebar footer into titlebar (after inspector toggle, separated by `.tb-sep`).

**Sidebar**
- Footer (`WP` avatar, Workspace name, WhisperX status) removed entirely.
- Search bar removed (HTML, CSS, JS filter).
- Card spacing: `margin-bottom: 1px → 4px`.
- Hover only on inactive items: `.rec-item:not(.rec-item--active):hover`.
- Card title row: time (`en-GB` 24h) right-aligned on same line as title via `.rec-item-time`; dot separator removed; duration remains on meta row below.

**Layout — full-width player bar**
- `#app` is now `flex-direction: column`.
- `#sidebar` + `#main-panel` are wrapped in `#app-row` (flex row, `flex: 1`).
- `#player-slot` is a sibling of `#app-row` inside `#app` — player bar renders here and spans the full window width.
- `_setView()` in `app.js` clears `#player-slot` when leaving editor mode.

**Waveform**
- Tooltip: two-line (`timecode` + speaker name); "Unknown speaker" for unrecognized.
- Hover segment highlight: bars belonging to hovered segment → `opacity: 1`; others → `0.32`. Tracked via `hoveredSeg` variable inside `buildWaveform`.

**Player controls**
- Speed button: `width: 46px; text-align: center` (no size jump). Speeds: `[1, 1.2, 1.5, 2]`.
- Volume: icon button opens `div.vol-popup` with vertical `input[type=range]` (closes on outside click).

**Unrecognized speaker card**
- `.spk-avatar` CSS added (was entirely missing) — circle, centered initials.
- `.spk-avatar--unknown` — solid border, gray background.
- Layout: `[avatar 32px] [.spk-card-info: name + meta] [.spk-card-play-btn: ► always visible]` — all vertically centered (`align-items: center` on `.spk-card-top`).
- Progress bar removed. "Name…" button removed.
- Quote text included inside card via `sample` parameter to `makeSpeakerCard`.
- Suggestion row (mocked): colored dot + "Likely [name] 87%" + ✓ (speaker color bg) + × buttons; row bg/border tinted with `speakerPalette(id).bg`.
- "Assign speaker" — full-width outlined button (`spk-assign-btn`), opens speaker picker.

### Key implementation details

- `buildEditor(transcript, knownSpeakers)` in `editor-view.js` is the main editor builder
- `playerAbortCtrl.signal` is the AbortSignal for all audio + DOM event listeners in `buildEditor`
- `focusPanel` has `position: relative` via CSS — safe to `position: absolute` children inside it
- `window.showToast(text, opts)` is a global function initialized in `app.init()`
- `fmtTime(seconds)`, `effectiveSpeaker(seg)`, `isUnrecognized(id, map)`, `speakerPalette(id)` are global utilities from `utils.js`
- `makeSpeakerCard(..., sample = null)` — last param passes quote text for unrecognized cards

### Remaining Speakers panel items (not yet implemented)

| # | Item |
|---|---|
| 1 | Tab bar: flat text style (currently segmented control pill) |
| 2 | Section headers: lowercase "Recognized · N" (currently uppercase) |
| 3 | Recognized speakers: flat rows with thin progress bar (currently cards) |
