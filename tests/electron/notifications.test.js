// Notifications of the main process: a refusal of the system is logged and kept for
// Settings, and the tray hint counts as shown only once the system showed it.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { createNotifier, notificationRefusal, rememberNotificationRefusal } = require(path.join(ROOT, 'electron', 'notifications.js'))
const { trayHintShown, rememberTrayHint } = require(path.join(ROOT, 'electron', 'tray.js'))

// Electron's Notification as far as notify() uses it; each one made is kept to fire events on.
function fakeNotification({ supported = true } = {}) {
  const made = []
  class FakeNotification extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.shown = false
      made.push(this)
    }
    static isSupported() { return supported }
    show() { this.shown = true }
  }
  return { Notification: FakeNotification, made }
}

function setup(options) {
  const fake = fakeNotification(options)
  const logged = []
  const refused = []
  let shownCount = 0
  const notifier = createNotifier({
    Notification: fake.Notification,
    log: line => logged.push(line),
    onRefused: refusal => refused.push(refusal),
    onShown: () => { shownCount += 1 },
  })
  return { ...fake, notifier, logged, refused, shown: () => shownCount }
}

const statePath = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-notify-')), 'app-state.json')

test('a notification is shown', () => {
  const { notifier, made } = setup()
  notifier.notify({ title: 'Call started', body: 'Record it?' })
  assert.equal(made.length, 1)
  assert.deepEqual(made[0].options, { title: 'Call started', body: 'Record it?' })
  assert.equal(made[0].shown, true)
})

test('a refusal of the system is logged with its error and the title', () => {
  const { notifier, made, logged } = setup()
  notifier.notify({ title: 'Call started', body: 'Record it?' })
  made[0].emit('failed', {}, 'Notifications are not allowed for this application')
  assert.equal(logged.length, 1)
  assert.match(logged[0], /Call started/)
  assert.match(logged[0], /Notifications are not allowed for this application/)
})

test('a refusal is passed on with its error and the title', () => {
  const { notifier, made, refused } = setup()
  notifier.notify({ title: 'Call started', body: 'Record it?' })
  made[0].emit('failed', {}, 'denied')
  assert.deepEqual(refused, [{ title: 'Call started', error: 'denied' }])
})

test('without notifications on this system nothing is made, and that is logged and passed on', () => {
  const { notifier, made, logged, refused } = setup({ supported: false })
  notifier.notify({ title: 'Sonorus', body: 'Still running.' })
  assert.equal(made.length, 0)
  assert.equal(logged.length, 1)
  assert.match(logged[0], /Sonorus/)
  assert.equal(refused.length, 1)
  assert.equal(refused[0].title, 'Sonorus')
  assert.match(refused[0].error, /not supported/)
})

test('a notification on screen is passed on as shown', () => {
  const { notifier, made, shown, refused } = setup()
  notifier.notify({ title: 'Call started', body: 'Record it?' })
  assert.equal(shown(), 0)
  made[0].emit('show', {})
  assert.equal(shown(), 1)
  assert.equal(refused.length, 0)
})

test('onShow of a notification runs on show, not on failed', () => {
  const { notifier, made } = setup()
  let calls = 0
  notifier.notify({ title: 'A', body: '' }, { onShow: () => { calls += 1 } })
  made[0].emit('failed', {}, 'denied')
  assert.equal(calls, 0)
  notifier.notify({ title: 'B', body: '' }, { onShow: () => { calls += 1 } })
  made[1].emit('show', {})
  assert.equal(calls, 1)
})

test('a click runs onClick; the notification is kept on screen until clicked, closed or refused', () => {
  const { notifier, made } = setup()
  let clicked = 0
  notifier.notify({ title: 'A', body: '' }, { onClick: () => { clicked += 1 } })
  notifier.notify({ title: 'B', body: '' })
  notifier.notify({ title: 'C', body: '' })
  assert.equal(notifier.onScreen(), 3)
  made[0].emit('click', {})
  assert.equal(clicked, 1)
  made[1].emit('close', {})
  made[2].emit('failed', {}, 'denied')
  assert.equal(notifier.onScreen(), 0)
})

test('a click without onClick does nothing', () => {
  const { notifier, made } = setup()
  notifier.notify({ title: 'A', body: '' })
  assert.doesNotThrow(() => made[0].emit('click', {}))
})

test('the tray hint is remembered only once the system showed it', () => {
  const file = statePath()
  const { notifier, made } = setup()
  notifier.notify({ title: 'Sonorus', body: 'Still running.' }, { onShow: () => rememberTrayHint(file) })
  assert.equal(trayHintShown(file), false)
  made[0].emit('failed', {}, 'denied')
  assert.equal(trayHintShown(file), false)
  notifier.notify({ title: 'Sonorus', body: 'Still running.' }, { onShow: () => rememberTrayHint(file) })
  made[1].emit('show', {})
  assert.equal(trayHintShown(file), true)
})

test('the last refusal is kept in app-state.json next to what is there, and cleared with null', () => {
  const file = statePath()
  assert.equal(notificationRefusal(file), null)
  rememberTrayHint(file)
  rememberNotificationRefusal(file, { title: 'Call started', error: 'denied' })
  assert.deepEqual(notificationRefusal(file), { title: 'Call started', error: 'denied' })
  assert.equal(trayHintShown(file), true)
  rememberNotificationRefusal(file, null)
  assert.equal(notificationRefusal(file), null)
  assert.equal(trayHintShown(file), true)
})

test('a broken or odd refusal in the file reads as none', () => {
  const file = statePath()
  fs.writeFileSync(file, '{not json', 'utf8')
  assert.equal(notificationRefusal(file), null)
  fs.writeFileSync(file, JSON.stringify({ notificationRefusal: 'denied' }), 'utf8')
  assert.equal(notificationRefusal(file), null)
  fs.writeFileSync(file, JSON.stringify({ notificationRefusal: { error: 3 } }), 'utf8')
  assert.equal(notificationRefusal(file), null)
})

test('main.js makes every notification through the notifier, the tray hint remembered on show', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  assert.doesNotMatch(main, /new Notification\(/)
  const hint = main.match(/function showTrayHint\(\) \{([\s\S]*?)\n\}/)[1]
  assert.match(hint, /onShow: \(\) => rememberTrayHint\(/)
  assert.equal(hint.match(/rememberTrayHint\(/g).length, 1)
})
