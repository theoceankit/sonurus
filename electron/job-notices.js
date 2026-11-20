// Notifications of finished and failed transcriptions (job_done, job_failed over WS
// /ws/queue). Only while the window is not in front: there its toast says it. Several of
// a kind close together become one, which replaces the one shown before.

const BURST_MS = 10000
const ALIGNMENT_MISSING = 'alignment_model_missing'

// On unless the setting, or all notifications, say false.
const jobNotificationsOn = settings => settings?.notifications !== false && settings?.notifyTranscriptions !== false

// No window (closed to the tray), or one hidden, minimized or behind another app.
const windowAway = win => !win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !win.isFocused()

// What a click opens: the recording, the failed job in the queue, or the dialog of the
// alignment model it lacked.
function intentFor(event) {
  if (event.type === 'job_done') return { open: 'recording', transcriptId: event.transcript_id }
  if (event.error_code === ALIGNMENT_MISSING && event.error_language) return { open: 'alignment-model', language: event.error_language }
  return { open: 'job', jobId: event.job_id }
}

const TEXT = {
  done: {
    one: title => `"${title}" is ready`,
    many: count => `${count} transcriptions are ready`,
    body: 'Click to open.',
  },
  failed: {
    one: title => `Transcription failed: "${title}"`,
    many: count => `${count} transcriptions failed`,
    body: 'Click to see what went wrong.',
  },
}

// The notification of an event, given the burst before it (or null) and the time now:
// { notice: {title, body}, intent, burst, replaces }, or null for any other event.
// A summary of ready ones opens the last recording, of failed ones the first job.
function jobNotice(event, burst, now) {
  const kind = event?.type === 'job_done' ? 'done' : event?.type === 'job_failed' ? 'failed' : null
  if (!kind) return null
  const text = TEXT[kind]
  const joins = !!burst && burst.kind === kind && now - burst.at <= BURST_MS
  if (!joins) {
    const intent = intentFor(event)
    return { notice: { title: text.one(event.title), body: text.body }, intent, burst: { kind, count: 1, at: now, intent }, replaces: false }
  }
  const count = burst.count + 1
  const intent = kind === 'done' ? intentFor(event) : burst.intent
  return { notice: { title: text.many(count), body: text.body }, intent, burst: { kind, count, at: now, intent }, replaces: true }
}

// notify(notice, onClick) → { close }; settings() → settings.json; windowAway() → whether
// the window is not in front. onEvent(event, open) shows what jobNotice() makes of an
// event, open(intent) on its click; reset() starts a new burst (the window came to front).
function createJobNotices({ notify, settings, windowAway: away, now = Date.now }) {
  let burst = null
  let shown = null

  function reset() {
    burst = null
    shown = null
  }

  function onEvent(event, open) {
    if (event?.type !== 'job_done' && event?.type !== 'job_failed') return
    if (!jobNotificationsOn(settings()) || !away()) {
      reset()
      return
    }
    const result = jobNotice(event, burst, now())
    if (result.replaces) shown?.close()
    burst = result.burst
    shown = notify(result.notice, () => open(result.intent))
  }

  return { onEvent, reset }
}

module.exports = { BURST_MS, createJobNotices, jobNotice, jobNotificationsOn, windowAway }
