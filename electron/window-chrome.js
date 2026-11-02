// The new UI draws its own title bar: no system frame, the system's window
// buttons over the page. Where they stand differs between systems and desktops,
// so the page asks for it through env(titlebar-area-*). The old UI keeps its frame.
//
// Values of tokens.css in the light theme, a build test keeps them in step. This
// is one colour for the window buttons until the dark theme is enabled.
const BG_SUNKEN = '#F6F6F9'
const TEXT_PRIMARY = '#242426'
const TITLEBAR_HEIGHT = 40

function windowChrome({ newUi }) {
  if (!newUi) return {}
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG_SUNKEN, symbolColor: TEXT_PRIMARY, height: TITLEBAR_HEIGHT },
    backgroundColor: BG_SUNKEN,
  }
}

module.exports = { windowChrome }
