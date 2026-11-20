// Notifications of finished and failed transcriptions: shown by the main process while
// the window is not in front, merged into one when several come close together.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { BURST_MS, createJobNotices, jobNotice, jobNotificationsOn, windowAway } = require(path.join(ROOT, 'electron', 'job-notices.js'))

const done = (id, title = `Recording ${id}`) => ({ type: 'job_done', job_id: `job-${id}`, title, transcript_id: id })
const failed = (id, extra = {}) => ({ type: 'job_failed', job_id: `job-${id}`, title: `Recording ${id}`, error: 'boom', error_code: null, error_language: null, ...extra })

test('a finished transcription: its title, and a click opens its recording', () => {
  const result = jobNotice(done(7, 'Standup'), null, 0)
  assert.deepEqual(result.notice, { title: '"Standup" is ready', body: 'Click to open.' })
  assert.deepEqual(result.intent, { open: 'recording', transcriptId: 7 })
  assert.equal(result.replaces, false)
})

test('a failed transcription: no error text, and a click shows the job', () => {
  const result = jobNotice(failed(3, { error: 'CUDA out of memory\nTraceback ...' }), null, 0)
  assert.deepEqual(result.notice, { title: 'Transcription failed: "Recording 3"', body: 'Click to see what went wrong.' })
  assert.deepEqual(result.intent, { open: 'job', jobId: 'job-3' })
  assert.doesNotMatch(JSON.stringify(result.notice), /CUDA/)
})

test('a missing alignment model: the same text, and a click opens the Alignment model dialog', () => {
  const result = jobNotice(failed(4, { error_code: 'alignment_model_missing', error_language: 'uk' }), null, 0)
  assert.equal(result.notice.title, 'Transcription failed: "Recording 4"')
  assert.deepEqual(result.intent, { open: 'alignment-model', language: 'uk' })
})

test('other events make no notification', () => {
  for (const type of ['snapshot', 'mic_app_active', 'call_ended', 'recording_failed', 'job_cancelled']) {
    assert.equal(jobNotice({ type, title: 'x' }, null, 0), null)
  }
})

test('the second of a kind within 10 s replaces the first with a count', () => {
  const first = jobNotice(done(1), null, 0)
  const second = jobNotice(done(2), first.burst, BURST_MS)
  assert.equal(second.replaces, true)
  assert.deepEqual(second.notice, { title: '2 transcriptions are ready', body: 'Click to open.' })
  const third = jobNotice(done(3), second.burst, BURST_MS * 2)
  assert.equal(third.replaces, true)
  assert.equal(third.notice.title, '3 transcriptions are ready')
})

test('the 10 s count from the one before, and past them a new single notification starts', () => {
  const first = jobNotice(done(1), null, 0)
  const later = jobNotice(done(2), first.burst, BURST_MS + 1)
  assert.equal(later.replaces, false)
  assert.equal(later.notice.title, '"Recording 2" is ready')
})

test('ready and failed do not mix', () => {
  const first = jobNotice(done(1), null, 0)
  const other = jobNotice(failed(2), first.burst, 1000)
  assert.equal(other.replaces, false)
  assert.equal(other.notice.title, 'Transcription failed: "Recording 2"')
  const again = jobNotice(done(3), other.burst, 2000)
  assert.equal(again.replaces, false)
  assert.equal(again.notice.title, '"Recording 3" is ready')
})

test('a summary of ready ones opens the last recording, of failed ones the first job', () => {
  let ready = jobNotice(done(1), null, 0)
  ready = jobNotice(done(2), ready.burst, 1000)
  assert.deepEqual(ready.intent, { open: 'recording', transcriptId: 2 })

  let fails = jobNotice(failed(5), null, 0)
  fails = jobNotice(failed(6), fails.burst, 1000)
  assert.deepEqual(fails.notice, { title: '2 transcriptions failed', body: 'Click to see what went wrong.' })
  assert.deepEqual(fails.intent, { open: 'job', jobId: 'job-5' })
})

test('on unless the setting or all notifications say false; an older settings file is on', () => {
  assert.equal(jobNotificationsOn({}), true)
  assert.equal(jobNotificationsOn(undefined), true)
  assert.equal(jobNotificationsOn({ notifications: true, notifyTranscriptions: true }), true)
  assert.equal(jobNotificationsOn({ notifyTranscriptions: false }), false)
  assert.equal(jobNotificationsOn({ notifications: false }), false)
  assert.equal(jobNotificationsOn({ notifications: false, notifyTranscriptions: true }), false)
})

// BrowserWindow as far as windowAway() asks it.
const win = (state = {}) => ({
  isDestroyed: () => !!state.destroyed,
  isVisible: () => state.visible !== false,
  isMinimized: () => !!state.minimized,
  isFocused: () => state.focused !== false,
})

test('the window is away when there is none, or it is hidden, minimized or not focused', () => {
  assert.equal(windowAway(null), true)
  assert.equal(windowAway(win({ destroyed: true })), true)
  assert.equal(windowAway(win({ visible: false })), true)
  assert.equal(windowAway(win({ minimized: true })), true)
  assert.equal(windowAway(win({ focused: false })), true)
  assert.equal(windowAway(win()), false)
})

function setup({ settings = {}, away = true } = {}) {
  const shown = []
  let time = 0
  let state = { settings, away }
  const jobs = createJobNotices({
    notify: (notice, onClick) => {
      const entry = { notice, onClick, closed: false }
      shown.push(entry)
      return { close: () => { entry.closed = true } }
    },
    settings: () => state.settings,
    windowAway: () => state.away,
    now: () => time,
  })
  return {
    jobs, shown,
    at: ms => { time = ms },
    set: patch => { state = { ...state, ...patch } },
  }
}

test('shown while the window is away; a click opens what it says', () => {
  const opened = []
  const { jobs, shown } = setup()
  jobs.onEvent(done(7), intent => opened.push(intent))
  assert.equal(shown.length, 1)
  shown[0].onClick()
  assert.deepEqual(opened, [{ open: 'recording', transcriptId: 7 }])
})

test('nothing while the window is in front, or with the setting or all notifications off', () => {
  for (const patch of [{ away: false }, { settings: { notifyTranscriptions: false } }, { settings: { notifications: false } }]) {
    const { jobs, shown } = setup(patch)
    jobs.onEvent(done(1), () => {})
    assert.equal(shown.length, 0)
  }
})

test('a summary closes the notification it replaces', () => {
  const { jobs, shown, at } = setup()
  jobs.onEvent(done(1), () => {})
  at(1000)
  jobs.onEvent(done(2), () => {})
  assert.equal(shown.length, 2)
  assert.equal(shown[0].closed, true)
  assert.equal(shown[1].closed, false)
  assert.equal(shown[1].notice.title, '2 transcriptions are ready')
})

test('the window in front starts a new burst', () => {
  const { jobs, shown, at } = setup()
  jobs.onEvent(done(1), () => {})
  jobs.reset()
  at(1000)
  jobs.onEvent(done(2), () => {})
  assert.equal(shown[0].closed, false)
  assert.equal(shown[1].notice.title, '"Recording 2" is ready')
})

test('an event while the window is in front does not join the burst before it', () => {
  const { jobs, shown, at, set } = setup()
  jobs.onEvent(done(1), () => {})
  set({ away: false })
  at(1000)
  jobs.onEvent(done(2), () => {})
  set({ away: true })
  at(2000)
  jobs.onEvent(done(3), () => {})
  assert.equal(shown.length, 2)
  assert.equal(shown[1].notice.title, '"Recording 3" is ready')
})

const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')

test('main.js passes the queue events to the job notices, with the window and its focus', () => {
  assert.match(main, /require\('\.\/job-notices'\)/)
  assert.match(main, /createJobNotices\(/)
  assert.match(main, /windowAway\(mainWin\)/)
  assert.match(main, /jobNotices\.onEvent\(event, openWithIntent\)/)
  assert.match(main, /on\('focus', \(\) => jobNotices\.reset\(\)\)/)
})

test('main.js has the setting on by default', () => {
  const defaults = main.match(/const DEFAULT_SETTINGS = \{([\s\S]*?)\n\}/)[1]
  assert.match(defaults, /notifyTranscriptions: true/)
})
