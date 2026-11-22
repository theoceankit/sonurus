// The colour of the Windows taskbar, for the tray icon (electron/tray.js). It follows the
// Windows mode (SystemUsesLightTheme), which can differ from the mode of the apps and from
// the theme of Sonorus. nativeTheme's shouldUseDarkColorsForSystemIntegratedUI does not
// do: it is empty until the first theme update and falls back to the theme of the apps,
// and a change of the Windows mode alone sends no update. So the registry is read here,
// at start and on WM_SETTINGCHANGE, which Windows sends to every top-level window.

const path = require('path')

const WM_SETTINGCHANGE = 0x001a
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'
const VALUE = 'SystemUsesLightTheme'
// One change of a setting sends the message several times.
const SETTLE_MS = 300

// true for dark, false for light, null when the output does not say.
function systemDark(output) {
  const found = new RegExp(`\\b${VALUE}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'i').exec(String(output))
  return found ? parseInt(found[1], 16) === 0 : null
}

// run(cmd, args) resolves with what the command printed. Dark until a read says
// otherwise: before Windows had the value, the taskbar was always dark.
function watchTaskbarTheme({
  run, onChange, systemRoot = process.env.SystemRoot || 'C:\\Windows', setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  // By its full path: Windows would look for a bare reg.exe in the working folder first.
  const reg = path.win32.join(systemRoot, 'System32', 'reg.exe')
  let dark = true
  let timer = null
  let reads = 0

  async function refresh() {
    const read = ++reads
    let found = null
    try {
      found = systemDark(await run(reg, ['query', KEY, '/v', VALUE]))
    } catch { /* not readable: the colour known before stays */ }
    if (read !== reads || found === null || found === dark) return
    dark = found
    onChange()
  }

  return {
    dark: () => dark,
    refresh,
    changed() {
      clearTimer(timer)
      timer = setTimer(() => void refresh(), SETTLE_MS)
    },
  }
}

module.exports = { systemDark, watchTaskbarTheme, WM_SETTINGCHANGE }
