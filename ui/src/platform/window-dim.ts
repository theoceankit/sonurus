// The system draws the window buttons over the page, where a modal's scrim does not
// reach. While a modal is open the main process dims them to match (electron/window-chrome.js).
// Only the change from none open to some and back is sent, once the changes of one
// moment are in: a window that takes over from another keeps them dimmed.
let holders = 0
let sent = false
let pending = false

function report() {
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    const dimmed = holders > 0
    if (dimmed === sent) return
    sent = dimmed
    window.electronAPI?.setWindowDimmed?.(dimmed)
  })
}

// Dims the window until the returned function is called.
export function holdWindowDim(): () => void {
  holders += 1
  report()
  let held = true
  return () => {
    if (!held) return
    held = false
    holders -= 1
    report()
  }
}
