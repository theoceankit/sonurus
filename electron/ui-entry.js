// What the window loads: the built UI (ui/dist). Only development may load a
// dev server (npm run dev:ui).
const path = require('path')

function uiEntry({ isPackaged, devUrl, electronDir }) {
  if (devUrl && !isPackaged) return { url: devUrl }
  return { file: path.join(electronDir, '..', 'ui', 'dist', 'index.html') }
}

module.exports = { uiEntry }
