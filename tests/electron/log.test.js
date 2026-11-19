'use strict'

// The app log (userData/sonorus.log): the main process is its only writer. Lines of
// the main process get the time; the backend's stderr goes in as it is, a whole line
// at a time; a log over the limit at start-up is kept as sonorus.log.1.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { backendOutput, configureLog, log, rotateLog } = require(path.join(ROOT, 'electron', 'log.js'))

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-log-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// console.error as the log uses it, kept for the test and given back after it.
function captureConsole(t) {
  const lines = []
  const original = console.error
  console.error = (...args) => { lines.push(args.join(' ')) }
  t.after(() => { console.error = original })
  return lines
}

function useLog(t, file) {
  configureLog({ file })
  t.after(() => configureLog({ file: null }))
}

const read = file => fs.readFileSync(file, 'utf8')

// ── log(line) ─────────────────────────────────────────────────────────────────

test('log() appends the line with the time, in the format of the backend lines', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  captureConsole(t)
  useLog(t, file)

  log('[backend] ready in 1200 ms')
  log('[notifications] "Done" not shown: denied')

  const lines = read(file).split('\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^\d\d:\d\d:\d\d \[backend\] ready in 1200 ms$/)
  assert.match(lines[1], /^\d\d:\d\d:\d\d \[notifications\] "Done" not shown: denied$/)
  assert.equal(lines[2], '')
})

test('log() uses the local time', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  captureConsole(t)
  useLog(t, file)

  const before = new Date()
  log('[x] now')
  const after = new Date()

  const pad = n => String(n).padStart(2, '0')
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const written = read(file).slice(0, 5)
  assert.ok([hhmm(before), hhmm(after)].includes(written), `${written} is not the local time`)
})

test('log() keeps writing to an existing log', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  fs.writeFileSync(file, 'earlier line\n')
  captureConsole(t)
  useLog(t, file)

  log('[x] next')

  assert.match(read(file), /^earlier line\n\d\d:\d\d:\d\d \[x\] next\n$/)
})

test('log() shows the line in the console too', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  const shown = captureConsole(t)
  useLog(t, file)

  log('[backend] GPU check: ok (cuda)')

  assert.equal(shown.length, 1)
  assert.match(shown[0], /\[backend\] GPU check: ok \(cuda\)$/)
})

test('before configureLog() a line goes to the console only, without an error', t => {
  const shown = captureConsole(t)
  configureLog({ file: null })

  assert.doesNotThrow(() => log('[x] early'))
  assert.equal(shown.length, 1)
})

test('a log that cannot be written does not throw, the console still gets the line', t => {
  const dir = tmpDir(t)
  const shown = captureConsole(t)

  // A folder in place of the file, then a file in a folder that does not exist.
  const asFolder = path.join(dir, 'sonorus.log')
  fs.mkdirSync(asFolder)
  useLog(t, asFolder)
  assert.doesNotThrow(() => log('[x] one'))

  configureLog({ file: path.join(dir, 'gone', 'sonorus.log') })
  assert.doesNotThrow(() => log('[x] two'))

  assert.equal(shown.filter(l => /\[x\] (one|two)$/.test(l)).length, 2)
})

test('after a failed write the next line is written once the file can be', t => {
  const dir = tmpDir(t)
  const file = path.join(dir, 'sub', 'sonorus.log')
  captureConsole(t)
  useLog(t, file)

  log('[x] lost')
  fs.mkdirSync(path.join(dir, 'sub'))
  log('[x] kept')

  assert.match(read(file), /^\d\d:\d\d:\d\d \[x\] kept\n$/)
})

// ── backendOutput() ───────────────────────────────────────────────────────────

test('backend output goes in as it is, a whole line at a time', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  useLog(t, file)
  const out = backendOutput()

  out.write('21:04:05 [TranscriptionQueue] job ')
  assert.equal(fs.existsSync(file), false, 'nothing before the line ends')
  out.write('3 started')
  out.write('\n21:04:06 [Pipeline] done\n')

  assert.equal(read(file), '21:04:05 [TranscriptionQueue] job 3 started\n21:04:06 [Pipeline] done\n')
})

test('a traceback goes in whole', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  useLog(t, file)
  const out = backendOutput()

  const traceback = [
    'ERROR:    Exception in ASGI application',
    'Traceback (most recent call last):',
    '  File "app/api/routers/queue.py", line 42, in add_job',
    '    raise ValueError("bad")',
    'ValueError: bad',
    '',
  ].join('\n')
  out.write(traceback.slice(0, 50))
  out.write(traceback.slice(50))

  assert.equal(read(file), traceback)
})

test('Windows line ends become plain ones', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  useLog(t, file)
  const out = backendOutput()

  out.write('one\r\ntwo\r')
  out.write('\nthree\r\n')

  assert.equal(read(file), 'one\ntwo\nthree\n')
})

test('a progress bar redrawn with \\r leaves only its last state', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  useLog(t, file)
  const out = backendOutput()

  out.write('model.bin:  10%|#         |\r')
  out.write('model.bin:  60%|######    |\r')
  out.write('model.bin: 100%|##########|\n')

  assert.equal(read(file), 'model.bin: 100%|##########|\n')
})

test('end() writes the last line without its line end', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  useLog(t, file)
  const out = backendOutput()

  out.write('done\nSegmentation fault')
  out.end()
  out.end()

  assert.equal(read(file), 'done\nSegmentation fault\n')
})

test('a backend that wrote nothing leaves no file', t => {
  const file = path.join(tmpDir(t), 'sonorus.log')
  useLog(t, file)
  const out = backendOutput()

  out.write('')
  out.end()

  assert.equal(fs.existsSync(file), false)
})

test('backend output that cannot be written does not throw', t => {
  const dir = tmpDir(t)
  useLog(t, path.join(dir, 'gone', 'sonorus.log'))
  const out = backendOutput()

  assert.doesNotThrow(() => { out.write('line\n'); out.end() })
})

// ── rotateLog() ───────────────────────────────────────────────────────────────

test('a log over the limit becomes sonorus.log.1, the old copy is replaced', t => {
  const dir = tmpDir(t)
  const file = path.join(dir, 'sonorus.log')
  fs.writeFileSync(file, 'x'.repeat(11))
  fs.writeFileSync(`${file}.1`, 'older')

  rotateLog(file, 10)

  assert.equal(fs.existsSync(file), false)
  assert.equal(read(`${file}.1`), 'x'.repeat(11))
})

test('a log at or under the limit stays where it is', t => {
  const dir = tmpDir(t)
  const file = path.join(dir, 'sonorus.log')
  fs.writeFileSync(file, 'x'.repeat(10))

  rotateLog(file, 10)

  assert.equal(read(file), 'x'.repeat(10))
  assert.equal(fs.existsSync(`${file}.1`), false)
})

test('the limit is 5 MiB by default', t => {
  const dir = tmpDir(t)
  const file = path.join(dir, 'sonorus.log')
  fs.writeFileSync(file, Buffer.alloc(5 * 1024 * 1024))
  rotateLog(file)
  assert.equal(fs.existsSync(file), true)

  fs.appendFileSync(file, 'x')
  rotateLog(file)
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.statSync(`${file}.1`).size, 5 * 1024 * 1024 + 1)
})

test('no log yet, or a log that cannot be moved: no error', t => {
  const dir = tmpDir(t)
  assert.doesNotThrow(() => rotateLog(path.join(dir, 'sonorus.log'), 10))
  assert.doesNotThrow(() => rotateLog(path.join(dir, 'gone', 'sonorus.log'), 10))
})

// ── wiring in the main process (by the sources) ───────────────────────────────

function electronSources() {
  return fs.readdirSync(path.join(ROOT, 'electron'))
    .filter(name => name.endsWith('.js'))
    .map(name => ({ name, text: fs.readFileSync(path.join(ROOT, 'electron', name), 'utf8') }))
}

test('the main process writes its lines only through log()', () => {
  const direct = electronSources()
    .filter(({ name, text }) => name !== 'log.js' && /console\.(log|info|warn|error|debug)\b/.test(text))
    .map(({ name }) => name)
  assert.deepEqual(direct, [])
})

test('the backend Electron starts gets no LOG_FILE: Electron is the only writer of sonorus.log', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'electron', 'backend.js'), 'utf8')
  assert.doesNotMatch(backend, /LOG_FILE\s*:/)
  assert.match(backend, /delete env\.LOG_FILE/)
})

test('the backend\'s stderr goes to the log, its stdout does not', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'electron', 'backend.js'), 'utf8')
  assert.match(backend, /backendOutput\(\)/)
  assert.match(backend, /child\.stderr\.on\('data'[^\n]*\.write\(/)
  assert.doesNotMatch(backend, /child\.stdout\.on\('data'[^\n]*\.write\((?!`\[backend\])/)
})

test('main.js points the log at userData and rotates it before the backend starts', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  const configured = main.indexOf('configureLog(')
  const userDataSet = main.indexOf("app.setPath('userData'")
  const rotated = main.indexOf('rotateLog(')
  const started = main.indexOf('await startBackend(')
  assert.ok(configured > userDataSet, 'configureLog after the userData path is set')
  assert.ok(rotated > main.indexOf('if (!singleInstance) return'), 'only the first instance rotates')
  assert.ok(rotated > 0 && rotated < started, 'rotated before the backend starts')
  assert.match(main, /sonorus\.log/)
  assert.doesNotMatch(main, /log: line => console\./)
})
