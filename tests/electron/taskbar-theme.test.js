// The colour of the Windows taskbar, for the quill of the tray: the theme of the system
// (SystemUsesLightTheme), read from the registry. nativeTheme does not tell it: empty
// until the first theme update, and no update when only the Windows mode changes.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { systemDark, watchTaskbarTheme, WM_SETTINGCHANGE } = require(path.join(ROOT, 'electron', 'taskbar-theme.js'))

// What reg query prints; the header is the key, the value line is the same in every language.
const printed = value => [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
  `    SystemUsesLightTheme    REG_DWORD    0x${value}`,
  '',
].join('\r\n')

function watch(answers) {
  const calls = []
  const changes = []
  const timers = new Map()
  let next = 0
  const theme = watchTaskbarTheme({
    run: async (...call) => {
      calls.push(call)
      const answer = await answers.shift()
      if (answer instanceof Error) throw answer
      return answer
    },
    onChange: () => changes.push(theme.dark()),
    systemRoot: 'C:\\Windows',
    setTimer: fn => { timers.set(++next, fn); return next },
    clearTimer: id => timers.delete(id),
  })
  // The timers that are due, run.
  const settle = async () => {
    const due = [...timers.values()]
    timers.clear()
    for (const fn of due) fn()
    await new Promise(setImmediate)
  }
  return { theme, calls, changes, settle }
}

test('the value says dark with 0 and light with 1', () => {
  assert.equal(systemDark(printed(0)), true)
  assert.equal(systemDark(printed(1)), false)
})

test('output without the value says nothing', () => {
  assert.equal(systemDark(''), null)
  assert.equal(systemDark('    AppsUseLightTheme    REG_DWORD    0x1'), null)
})

test('a light taskbar is known from the first read, before any change of theme', async () => {
  const { theme, changes } = watch([printed(1)])
  await theme.refresh()
  assert.equal(theme.dark(), false)
  assert.deepEqual(changes, [false])
})

test('only the Windows mode is asked for, not the mode of the apps, by the reg of the system', async () => {
  const { theme, calls } = watch([printed(0)])
  await theme.refresh()
  assert.deepEqual(calls, [['C:\\Windows\\System32\\reg.exe', [
    'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme',
  ]]])
})

test('without the value the taskbar is dark, as before Windows had a light one', async () => {
  const { theme, changes } = watch([new Error('unable to find the key')])
  await theme.refresh()
  assert.equal(theme.dark(), true)
  assert.deepEqual(changes, [])
})

test('a failed read keeps the colour known before', async () => {
  const { theme } = watch([printed(1), new Error('timed out')])
  await theme.refresh()
  await theme.refresh()
  assert.equal(theme.dark(), false)
})

test('a changed setting is read once the burst of messages is over', async () => {
  const { theme, calls, changes, settle } = watch([printed(1), printed(0)])
  await theme.refresh()
  theme.changed()
  theme.changed()
  theme.changed()
  assert.equal(calls.length, 1)
  await settle()
  assert.equal(calls.length, 2)
  assert.deepEqual(changes, [false, true])
})

test('a setting that is not the theme changes nothing', async () => {
  const { theme, changes, settle } = watch([printed(0), printed(0)])
  await theme.refresh()
  theme.changed()
  await settle()
  assert.deepEqual(changes, [])
})

test('an older read that ends late does not undo a newer one', async () => {
  let late
  const { theme } = watch([new Promise(resolve => { late = resolve }), printed(1)])
  const first = theme.refresh()
  await theme.refresh()
  late(printed(0))
  await first
  assert.equal(theme.dark(), false)
})

test('the message is WM_SETTINGCHANGE', () => {
  assert.equal(WM_SETTINGCHANGE, 0x001a)
})
