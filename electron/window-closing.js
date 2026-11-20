// Before the window goes (closed to the tray, or the app quits), the page saves
// what is still waiting, such as a note typed a moment ago. destroy() and quitting
// give the page no unload of its own, so main asks it and waits for its answer, or
// a short while for a page that never answers.
const FINISH_TIMEOUT_MS = 1500

let lastAsk = 0

function askWindowToFinish(win, { ipc, timeoutMs = FINISH_TIMEOUT_MS }) {
  if (!win || win.isDestroyed()) return Promise.resolve()
  const id = ++lastAsk
  return new Promise(resolve => {
    let timer
    const done = (event, answered) => {
      if (answered === id && event.sender === win.webContents) finish()
    }
    function finish() {
      clearTimeout(timer)
      ipc.removeListener('window-closing-done', done)
      resolve()
    }
    timer = setTimeout(finish, timeoutMs)
    ipc.on('window-closing-done', done)
    win.webContents.send('window-closing', id)
  })
}

module.exports = { askWindowToFinish, FINISH_TIMEOUT_MS }
