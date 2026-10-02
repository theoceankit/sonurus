// ── Unimplemented controls ─────────────────────────────────────────────────────
// A control whose feature does not exist yet stays visible, dimmed and
// clickable: a click only shows NOT_IMPLEMENTED_TOAST and never reaches the
// control's own handlers, so its state and the saved settings do not change.
//
// NOT_IMPLEMENTED lists every such control. A control is marked where it is
// built with markNotImplemented(el, id). When a feature lands, remove its id
// here and the markNotImplemented() call (tests/renderer/not-implemented.test.js
// fails if only one of the two is removed).

const NOT_IMPLEMENTED_TOAST = 'Not available yet'

const NOT_IMPLEMENTED = new Set([
  'recording.diarize',      // New recording modal → "Diarize speakers" toggle
  'settings.export',        // Settings → Export (format, duplicate, include-*)
  'settings.app-language',  // Settings → Interface → App language
  'settings.include-mic',   // Settings → Audio devices → Include microphone
  'sidebar.filter-notes',   // Sidebar → Notes filter chip
  'sidebar.filter-marked',  // Sidebar → Marked filter chip
  'titlebar.search',        // Titlebar → Search transcripts…
  'titlebar.share',         // Titlebar → Share
  'editor.tab-chapters',    // Editor right panel → Chapters tab
  'editor.tab-notes',       // Editor right panel → Notes tab
  'editor.tab-activity',    // Editor right panel → Activity tab
  'editor.add-tag',         // Editor header → "+ tag"
  'editor.highlight',       // Editor selection toolbar → Highlight
  'segment.bookmark',       // Segment row → Bookmark ("Save for later")
])

// Marks `el` as unimplemented if `id` is registered; otherwise leaves it alone.
function markNotImplemented(el, id) {
  if (!NOT_IMPLEMENTED.has(id)) return el
  el.dataset.notImplemented = id
  el.classList.add('not-implemented')
  el.setAttribute('aria-disabled', 'true')
  return el
}

// Click handler: stops a click on (or inside) a marked control before any other
// handler sees it and shows the toast instead.
function notImplementedClick(e, toast) {
  if (!e.target?.closest?.('[data-not-implemented]')) return
  e.preventDefault()
  e.stopImmediatePropagation()
  toast(NOT_IMPLEMENTED_TOAST)
}

// Installed once on `document` by app.init(). Capture phase, so it runs before
// the control's own listeners and before delegated listeners on its parents.
function installNotImplementedGuard(root) {
  root.addEventListener('click', e => notImplementedClick(e, text => window.showToast?.(text)), true)
}
