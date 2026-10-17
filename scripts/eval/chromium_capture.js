// Record a WAV file the way the app records the microphone: Chromium plays the
// file as a fake capture device, the page records it with getUserMedia →
// AudioContext → MediaStreamDestination → MediaRecorder (audio/webm;codecs=opus),
// as electron/renderer/app.js does. Used by the quality tests (tests/quality/)
// to measure what Chromium's microphone processing does to speech.
//
//   npx electron scripts/eval/chromium_capture.js <input.wav> <output.webm> <default|raw>
//
// default: getUserMedia({ audio: true }) like the app — echo cancellation,
//          noise suppression and auto gain control on (Chromium defaults)
// raw:     the same with all three turned off
// Runs in real time (the length of the input).
const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const [input, output, mode] = process.argv.slice(-3).map(String)
if (!input || !output || !['default', 'raw'].includes(mode)) {
  console.error('usage: electron chromium_capture.js <input.wav> <output.webm> <default|raw>')
  process.exit(2)
}

function wavSeconds(file) {
  const buf = fs.readFileSync(file)
  let pos = 12, rate = 0, bytesPerSec = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4), size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') { rate = buf.readUInt32LE(pos + 12); bytesPerSec = buf.readUInt32LE(pos + 16) }
    if (id === 'data') return size / bytesPerSec
    pos += 8 + size + (size & 1)
  }
  throw new Error(`${file}: no data chunk (rate ${rate})`)
}

const seconds = wavSeconds(input)
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', `${path.resolve(input)}%noloop`)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Own profile: nothing of the developer's sonorus-dev userData is touched.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-capture-'))
app.setPath('userData', profile)

const constraints = mode === 'raw'
  ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
  : { audio: true }

// Same graph as app.js startRecording(); stops 1 s after the file ends.
const recordScript = `(async () => {
  const stream = await navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)})
  const settings = stream.getAudioTracks()[0].getSettings()
  const audioCtx = new AudioContext()
  const dest = audioCtx.createMediaStreamDestination()
  audioCtx.createMediaStreamSource(stream).connect(dest)
  const chunks = []
  const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' })
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  const stopped = new Promise(r => { recorder.onstop = r })
  recorder.start(1000)
  await new Promise(r => setTimeout(r, ${Math.ceil((seconds + 1) * 1000)}))
  recorder.stop()
  await stopped
  stream.getTracks().forEach(t => t.stop())
  const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { data: btoa(bin), settings, sampleRate: audioCtx.sampleRate }
})()`

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true))
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  // A file:// page like the app's (a data: URL is not a secure context: no getUserMedia).
  const page = path.join(profile, 'capture.html')
  fs.writeFileSync(page, '<!doctype html><title>capture</title>')
  await win.loadFile(page)
  try {
    const { data, settings, sampleRate } = await win.webContents.executeJavaScript(recordScript)
    const buf = Buffer.from(data, 'base64')
    fs.writeFileSync(output, buf)
    console.log(JSON.stringify({
      output, mode, seconds, bytes: buf.length,
      kbps: Math.round(buf.length * 8 / seconds / 1000), sampleRate, settings,
    }))
    process.exitCode = 0
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  }
  fs.rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode)
})
