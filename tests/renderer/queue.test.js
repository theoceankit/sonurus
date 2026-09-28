const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const {
  queueStateLabel, queueToggle, jobStatusText, deleteJobPrompt, queueJobCount,
  importRequest, dataResetBlockReason,
} = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))

const snap = over => ({
  type: 'snapshot', paused: false, paused_by_recording: false, recording: false,
  start_mode: 'auto', running_job_id: null, step: null, jobs: [], ...over,
})
const job = over => ({
  id: 'j1', audio_path: '/data/recordings/sonorus-import-1.wav', title: 'Weekly sync',
  whisper_model: 'small', language: null, status: 'waiting',
  error: null, error_code: null, error_language: null, created_at: '', ...over,
})

// ── Queue header ───────────────────────────────────────────────────────────────

test('queueStateLabel: running, paused, paused by a recording', () => {
  assert.equal(queueStateLabel(snap()), 'Running')
  assert.equal(queueStateLabel(snap({ paused: true })), 'Paused')
  assert.equal(queueStateLabel(snap({ paused: true, paused_by_recording: true, recording: true })),
    'Paused while recording')
})

test('queueToggle: Pause while running, Start while paused (also during a recording)', () => {
  assert.deepEqual(plain(queueToggle(snap())), { action: 'pause', label: 'Pause', icon: 'pause' })
  assert.deepEqual(plain(queueToggle(snap({ paused: true }))), { action: 'start', label: 'Start', icon: 'play' })
  assert.equal(queueToggle(snap({ paused: true, paused_by_recording: true, recording: true })).action, 'start')
})

test('queueJobCount: every job in the queue', () => {
  assert.equal(queueJobCount(null), 0)
  assert.equal(queueJobCount(snap({ jobs: [job(), job({ id: 'j2', status: 'failed' })] })), 2)
})

// ── Job card ───────────────────────────────────────────────────────────────────

test('jobStatusText: the running job shows its step', () => {
  const s = snap({ running_job_id: 'j1', step: 'Transcribing audio…' })
  assert.equal(jobStatusText(job({ status: 'running' }), s), 'Transcribing audio…')
  assert.equal(jobStatusText(job({ status: 'running' }), snap({ running_job_id: 'j1' })), 'Starting…')
})

test('jobStatusText: waiting jobs', () => {
  assert.equal(jobStatusText(job(), snap()), 'Waiting')
  assert.equal(jobStatusText(job(), snap({ paused: true })), 'Waiting · queue paused')
})

test('jobStatusText: a failed job shows the first line of its error', () => {
  const failed = job({ status: 'failed', error: 'Failed to load audio: ffmpeg version n9\n  built with gcc' })
  assert.equal(jobStatusText(failed, snap()), 'Failed to load audio: ffmpeg version n9')
  assert.equal(jobStatusText(job({ status: 'failed', error: null }), snap()), 'Failed')
})

test('jobStatusText: a missing alignment model names the language', () => {
  const failed = job({ status: 'failed', error: 'long text', error_code: 'alignment_model_missing', error_language: 'de' })
  assert.equal(jobStatusText(failed, snap()), 'Alignment model for "de" is not installed')
})

test('deleteJobPrompt: an import keeps the original file', () => {
  const p = deleteJobPrompt(job())
  assert.equal(p.title, 'Delete “Weekly sync”?')
  assert.match(p.body, /original file is kept/)
})

test('deleteJobPrompt: a live recording is gone for good', () => {
  const p = deleteJobPrompt(job({ audio_path: '/data/recordings/sonorus-rec-1.webm', title: 'Call' }))
  assert.equal(p.title, 'Delete “Call”?')
  assert.match(p.body, /recording will be deleted/)
  assert.match(p.body, /cannot be undone/)
})

// ── Requests ───────────────────────────────────────────────────────────────────

test('importRequest: queues the file with POST /queue/jobs', () => {
  const r = importRequest('/in/a.mp3', { model: 'small', language: 'auto' })
  assert.equal(r.url, 'http://localhost:8000/queue/jobs')
  assert.equal(r.method, 'POST')
})

test('dataResetBlockReason: a running job asks to pause the queue', () => {
  assert.match(dataResetBlockReason(1, null), /pause the transcription queue/i)
})
