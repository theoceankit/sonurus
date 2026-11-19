// The app log, userData/sonorus.log. The main process is its only writer: its own
// lines through log(), and the stderr of the backend it started through
// backendOutput(), which carries the backend's own log lines (app/logger.py), uvicorn
// tracebacks and anything else the backend or the pipeline print there. One writer,
// because on Windows Python's appends are a seek plus a write, so lines of a second
// writer could overwrite each other, and a file Python holds open cannot be renamed.
// No dependency on Electron: main.js gives the path once the userData path is known.
const fs = require('fs')

let logFile = null

// file: the log's path; null until main.js sets it, lines then only reach the console.
function configureLog({ file }) {
  logFile = file || null
}

// Never throws: a log that cannot be written (no access, full disk, folder gone)
// loses the line and leaves the app running; the next line tries again.
function append(text) {
  if (!logFile) return
  try { fs.appendFileSync(logFile, text) } catch { /* the console still has it */ }
}

const pad = n => String(n).padStart(2, '0')
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

// A line of the main process, its source first, as the backend's lines are:
// log('[backend] ready in 1200 ms') → "21:04:05 [backend] ready in 1200 ms".
function log(line) {
  console.error(line)
  append(`${clock()} ${line}\n`)
}

// The stderr of the backend, in pieces as they arrive (strings): each line goes in
// as it is, once it is whole. \r\n ends a line too; a line redrawn with \r (a progress
// bar) keeps its last state. end() writes what is left when the backend has exited.
function backendOutput() {
  let pending = ''
  const finish = line => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line
    return text.slice(text.lastIndexOf('\r') + 1)
  }
  return {
    write(chunk) {
      pending += chunk
      const end = pending.lastIndexOf('\n')
      if (end < 0) return
      const lines = pending.slice(0, end).split('\n').map(finish)
      pending = pending.slice(end + 1)
      append(`${lines.join('\n')}\n`)
    },
    end() {
      const last = finish(pending)
      pending = ''
      if (last) append(`${last}\n`)
    },
  }
}

const MAX_LOG_BYTES = 5 * 1024 * 1024

// At start-up, before the backend runs: a log over the limit becomes sonorus.log.1
// (replacing the previous one) and a new log starts. Any failure keeps the log as is.
function rotateLog(file, maxBytes = MAX_LOG_BYTES) {
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`)
  } catch { /* no log yet, or it cannot be moved: keep appending to it */ }
}

module.exports = { backendOutput, configureLog, log, rotateLog }
