// ── Icons ───────────────────────────────────────────────────────────────────────
// Every UI icon is a file: electron/assets/icons/<name>.svg (see README.md there).
// The file is drawn as a CSS mask filled with currentColor, so an icon takes the
// text color of its parent and the colors inside the SVG file are ignored.
// Styles are inline: setup.html's CSP allows inline styles but no stylesheets.
const ICONS_DIR = '../assets/icons'

function iconUrl(name) {
  return `${ICONS_DIR}/${name}.svg`
}

function _iconStyle(name, size) {
  const mask = `url('${iconUrl(name)}') center / contain no-repeat`
  return `display:inline-block;flex:none;vertical-align:middle;width:${size}px;height:${size}px;` +
    `background-color:currentColor;-webkit-mask:${mask};mask:${mask}`
}

// HTML for an icon, for innerHTML / template strings. `size` is the square box in px.
function icon(name, size = 14, cls = '') {
  const classes = cls ? `icon ${cls}` : 'icon'
  return `<span class="${classes}" data-icon="${name}" aria-hidden="true" style="${_iconStyle(name, size)}"></span>`
}

// Static markup writes <span data-icon="name" data-size="12"></span>; this fills
// in the mask. An existing inline style (e.g. a color) is kept.
function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]:not(.icon)').forEach(el => {
    const size = Number(el.dataset.size) || 14
    el.classList.add('icon')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = _iconStyle(el.dataset.icon, size) + ';' + el.style.cssText
  })
}

if (typeof document !== 'undefined') hydrateIcons(document)
