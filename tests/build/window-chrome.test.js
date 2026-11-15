'use strict'

// The UI draws its own title bar over a window without a system frame.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { windowChrome, themeSource, THEMES } = require(path.join(ROOT, 'electron', 'window-chrome.js'))

const tokens = fs.readFileSync(path.join(ROOT, 'ui', 'src', 'styles', 'tokens.css'), 'utf8')
const token = name => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))[1]
// A semantic token of one theme block, resolved through the palette to its value.
const themeBlock = theme => tokens.slice(tokens.indexOf(`[data-theme='${theme}'] {`)).split('\n}')[0]
const themed = (theme, name) => {
  const value = themeBlock(theme).match(new RegExp(`${name}:\\s*([^;]+);`))[1]
  const palette = value.match(/^var\((--[\w-]+)\)$/)
  return palette ? token(palette[1]) : value
}
const alpha = rgba => Number(rgba.match(/rgba\([^)]*,\s*([\d.]+)\)/)[1])

test('the window hides the frame and keeps the system window buttons', () => {
  const chrome = windowChrome()
  assert.equal(chrome.titleBarStyle, 'hidden')
  assert.ok(chrome.titleBarOverlay)
})

for (const theme of ['light', 'dark']) {
  test(`the window buttons match the title bar of the ${theme} theme`, () => {
    const { titleBarOverlay, backgroundColor } = windowChrome(theme === 'dark')
    assert.equal(titleBarOverlay.color, themed(theme, '--color-bg-sunken'))
    assert.equal(backgroundColor, themed(theme, '--color-bg-sunken'))
    assert.equal(titleBarOverlay.symbolColor, themed(theme, '--color-text-primary'))
  })

  test(`the strip dims as much as the scrim of the ${theme} theme`, () => {
    assert.equal(THEMES[theme].scrimAlpha, alpha(themed(theme, '--color-scrim')))
  })
}

test('the light theme is the one without a dark preference', () => {
  assert.deepEqual(windowChrome(), windowChrome(false))
})

test('a saved theme that is not one of the three follows the system', () => {
  for (const source of ['system', 'light', 'dark']) assert.equal(themeSource(source), source)
  for (const source of [undefined, null, '', 'Dark', 'blue', 1]) assert.equal(themeSource(source), 'system')
})

test('the window buttons are as high as the title bar', () => {
  assert.equal(`${windowChrome().titleBarOverlay.height}px`, token('--size-titlebar'))
})

test('main.js applies the chrome after its own settings and keeps the window size', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  assert.match(main, /minWidth:\s+900/)
  assert.match(main, /minHeight:\s+600/)
  assert.match(main, /backgroundColor: '#FFFFFF',[\s\S]*\.\.\.windowChrome\(nativeTheme\.shouldUseDarkColors\)[\s\S]*webPreferences/)
})

// A modal's scrim cannot reach the strip of the window buttons: the system draws it
// over the page. The main process darkens the strip to the colour of the page under
// the scrim, with the scrim's timing.

const { dimmedOverlay, cubicBezier, overlayDimmer, DIM, THEME_FADE } = require(path.join(ROOT, 'electron', 'window-chrome.js'))

const bezier = name => token(name).match(/cubic-bezier\(([^)]+)\)/)[1].split(',').map(Number)

test('the dimmed strip has the colours of the page under the scrim', () => {
  // #F6F6F9 and #242426 with 40 % black over them.
  assert.deepEqual(dimmedOverlay(0), { color: '#F6F6F9', symbolColor: '#242426' })
  assert.deepEqual(dimmedOverlay(1), { color: '#949495', symbolColor: '#161617' })
  // Dark: #101012 and #F6F6F9 with 60 % black over them.
  assert.deepEqual(dimmedOverlay(0, true), { color: '#101012', symbolColor: '#F6F6F9' })
  assert.deepEqual(dimmedOverlay(1, true), { color: '#060607', symbolColor: '#626264' })
})

test('the strip dims with the timing and curves of the modal scrim', () => {
  assert.equal(`${DIM.inMs}ms`, token('--duration-slow'))
  assert.equal(`${DIM.outMs}ms`, token('--duration-base'))
  assert.deepEqual(DIM.easeIn, bezier('--ease-enter'))
  assert.deepEqual(DIM.easeOut, bezier('--ease-exit'))
  const motion = fs.readFileSync(path.join(ROOT, 'ui', 'src', 'styles', 'motion.module.css'), 'utf8')
  assert.match(motion, /--motion-in: var\(--duration-slow\);\s*--motion-out: var\(--duration-base\);/)
})

test('the cubic Bézier curve runs from 0 to 1 like the CSS one', () => {
  const linear = cubicBezier([0, 0, 1, 1])
  assert.equal(linear(0.3).toFixed(3), '0.300')
  const exit = cubicBezier([0.4, 0, 1, 1])
  assert.equal(exit(0), 0)
  assert.equal(exit(1), 1)
  // ease-in: slow at first.
  assert.ok(exit(0.5) < 0.5)
  const enter = cubicBezier([0.16, 1, 0.3, 1])
  assert.ok(enter(0.2) > 0.6)
})

function clock() {
  let time = 0
  let timer = null
  const applied = []
  const dimmer = overlayDimmer(overlay => applied.push(overlay), {
    now: () => time,
    setTimer: fn => { timer = fn; return 1 },
    clearTimer: () => { timer = null },
  })
  const tick = ms => {
    time += ms
    const fn = timer
    timer = null
    if (fn) fn()
  }
  return { dimmer, applied, tick, running: () => timer !== null }
}

test('dimming moves to the dark colours over the length of the scrim and stops', () => {
  const { dimmer, applied, tick, running } = clock()
  dimmer.set(true)
  assert.ok(running())
  while (running()) tick(16)
  assert.deepEqual(applied.at(-1), dimmedOverlay(1))
  assert.ok(applied.length >= 200 / 16 - 1 && applied.length <= 200 / 16 + 2, `${applied.length} frames`)
  dimmer.set(false)
  const before = applied.length
  while (running()) tick(16)
  assert.deepEqual(applied.at(-1), dimmedOverlay(0))
  assert.ok(applied.length - before <= 150 / 16 + 2)
})

test('closing halfway goes back from where the strip is, without a jump', () => {
  const { dimmer, applied, tick, running } = clock()
  dimmer.set(true)
  tick(16); tick(16); tick(16)
  const halfway = applied.at(-1)
  dimmer.set(false)
  tick(16)
  const next = applied.at(-1)
  const lightness = hex => parseInt(hex.color.slice(1, 3), 16)
  assert.ok(lightness(next) >= lightness(halfway))
  assert.ok(lightness(next) - lightness(halfway) < 20)
  while (running()) tick(16)
  assert.deepEqual(applied.at(-1), dimmedOverlay(0))
})

test('the first colour is set at once, not a frame later', () => {
  const { dimmer, applied, tick } = clock()
  tick(1000)
  dimmer.set(true, 1000 - 10)
  assert.equal(applied.length, 1)
  assert.deepEqual(applied[0], dimmedOverlay(cubicBezier(DIM.easeIn)(10 / DIM.inMs)))
})

test('the strip keeps time from when the page started dimming, not from when it heard of it', () => {
  const { dimmer, applied, tick } = clock()
  tick(1000)
  dimmer.set(true, 1000 - 40)
  assert.deepEqual(applied[0], dimmedOverlay(cubicBezier(DIM.easeIn)(40 / DIM.inMs)))
})

test('a start time from the future or long ago does not make the strip jump', () => {
  const late = clock()
  late.tick(1000)
  late.dimmer.set(true, 5000)
  assert.deepEqual(late.applied[0], dimmedOverlay(0))
  late.tick(16)
  assert.deepEqual(late.applied[1], dimmedOverlay(cubicBezier(DIM.easeIn)(16 / DIM.inMs)))
  const early = clock()
  early.tick(1000)
  early.dimmer.set(true, 0)
  assert.ok(early.applied.length === 1 && early.applied[0].color !== dimmedOverlay(1).color)
})

test('asking for the state the strip is in does nothing', () => {
  const { dimmer, applied, running } = clock()
  dimmer.set(false)
  assert.equal(applied.length, 0)
  assert.equal(running(), false)
})

test('a change of theme moves the strip to the new colours with the page\'s cross-fade', () => {
  assert.equal(`${THEME_FADE.ms}ms`, token('--duration-move'))
  assert.deepEqual(THEME_FADE.ease, bezier('--ease-standard'))
  const { dimmer, applied, tick, running } = clock()
  dimmer.setTheme(true)
  assert.ok(running())
  while (running()) tick(16)
  assert.deepEqual(applied.at(-1), dimmedOverlay(0, true))
  assert.ok(applied.length >= 250 / 16 - 1 && applied.length <= 250 / 16 + 2, `${applied.length} frames`)
  // Halfway between, never a jump to either end.
  const middle = applied[Math.floor(applied.length / 2)]
  assert.notEqual(middle.color, dimmedOverlay(0).color)
  assert.notEqual(middle.color, dimmedOverlay(0, true).color)
})

test('the colours between the themes run from one to the other', () => {
  assert.deepEqual(dimmedOverlay(0, 0), dimmedOverlay(0, false))
  assert.deepEqual(dimmedOverlay(1, 1), dimmedOverlay(1, true))
  // #F6F6F9 and #101012 halfway.
  assert.equal(dimmedOverlay(0, 0.5).color, '#838386')
})

test('a modal that opens while the theme changes dims the strip as it moves', () => {
  const { dimmer, applied, tick, running } = clock()
  dimmer.setTheme(true)
  tick(16); tick(16)
  dimmer.set(true)
  assert.ok(running())
  while (running()) tick(16)
  assert.deepEqual(applied.at(-1), dimmedOverlay(1, true))
})

test('a theme the strip is already in, or is moving to, changes nothing', () => {
  const { dimmer, applied, running } = clock()
  dimmer.setTheme(false)
  assert.equal(applied.length, 0)
  assert.equal(running(), false)
})

test('a strip that starts dark stays dark until the theme changes', () => {
  const applied = []
  const dimmer = overlayDimmer(overlay => applied.push(overlay), { dark: true, now: () => 0, setTimer: () => 1, clearTimer: () => {} })
  dimmer.setTheme(true)
  assert.equal(applied.length, 0)
  // The first frame of a modal opening, in the dark colours.
  dimmer.set(true)
  assert.deepEqual(applied[0], dimmedOverlay(0, true))
})

test('main.js follows the saved theme and the system', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  assert.match(main, /theme: 'system',/)
  assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*nativeTheme\.themeSource = themeSource\(savedSettings\(\)\.theme\)[\s\S]*createWindow\(\)/)
  assert.match(main, /ipcMain\.handle\('set-theme', \(_e, source\) => \{\s*nativeTheme\.themeSource = themeSource\(source\)/)
  assert.match(main, /nativeTheme\.on\('updated'/)
  assert.match(main, /dark: nativeTheme\.shouldUseDarkColors,/)
  assert.match(main, /titleBarDimmer\?\.setTheme\(nativeTheme\.shouldUseDarkColors\)/)
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8')
  assert.match(preload, /setTheme:\s*\(source\) => ipcRenderer\.invoke\('set-theme', source\)/)
})

test('main.js dims the strip of the window buttons except on macOS', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
  assert.match(main, /ipcMain\.on\('window-dimmed', \(event, dimmed, startedAt\) =>/)
  assert.match(main, /if \(process\.platform !== 'darwin'\) \{\s*titleBarDimmer = overlayDimmer/)
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8')
  assert.match(preload, /setWindowDimmed:\s*\(dimmed, startedAt\) => ipcRenderer\.send\('window-dimmed', dimmed, startedAt\)/)
})
