// What the window loads. The new UI (ui/) lives next to the old one until the
// cutover: a hidden --new-ui switch opens it, in the packaged app too, so a
// build can be checked. Only development may load a dev server (npm run dev:ui).
const path = require('path')

function uiEntry({ isPackaged, newUi, devUrl, electronDir }) {
  if (!newUi) return { file: path.join(electronDir, 'renderer', 'index.html') }
  if (devUrl && !isPackaged) return { url: devUrl }
  return { file: path.join(electronDir, '..', 'ui', 'dist', 'index.html') }
}

module.exports = { uiEntry }
