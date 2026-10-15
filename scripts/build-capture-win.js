#!/usr/bin/env node
'use strict'

// Builds the Windows system audio helper (WASAPI loopback):
//   native/windows/sonorus-capture/main.cpp → electron/resources/win/sonorus-capture.exe
//
// Run before packaging for Windows:  npm run build:capture:win
//
// On Windows it uses MSVC (cl from a Developer prompt, or found with vswhere);
// the C runtime is linked statically, so the helper needs no VC++ runtime.
// Elsewhere (and on Windows without MSVC) it cross-compiles with mingw-w64
// (x86_64-w64-mingw32-g++, package mingw-w64-gcc / g++-mingw-w64-x86-64).
// With no compiler at all, an already built helper newer than its source
// (e.g. cross-compiled on Linux and copied in) is kept.

const fs            = require('fs')
const os            = require('os')
const path          = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC  = path.join(ROOT, 'native', 'windows', 'sonorus-capture', 'main.cpp')
const OUT  = path.join(ROOT, 'electron', 'resources', 'win', 'sonorus-capture.exe')
const MINGW = 'x86_64-w64-mingw32-g++'

function compileCommand(toolchain, src, out, objDir = os.tmpdir()) {
  if (toolchain === 'msvc') {
    return {
      cmd: 'cl',
      args: ['/nologo', '/std:c++17', '/O2', '/MT', '/EHsc', '/utf-8', '/W3',
             src, `/Fo${objDir}${path.sep}`, `/Fe${out}`, '/link', 'ole32.lib'],
    }
  }
  return {
    cmd: MINGW,
    args: ['-std=c++17', '-O2', '-Wall', '-municode', '-static', '-s', src, '-o', out, '-lole32'],
  }
}

function has(cmd, probe) {
  const r = spawnSync(cmd, probe, { stdio: 'ignore', shell: process.platform === 'win32' })
  return r.status === 0
}

// vcvars64.bat of the newest Visual Studio / Build Tools with the C++ tools.
function findVcvars() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
                            'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!fs.existsSync(vswhere)) return null
  const r = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
                                'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                                '-property', 'installationPath'], { encoding: 'utf8' })
  const dir = (r.stdout || '').trim().split(/\r?\n/)[0]
  const bat = dir && path.join(dir, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  return bat && fs.existsSync(bat) ? bat : null
}

// A helper already in place that is not older than its source.
function upToDate(out = OUT, src = SRC) {
  return fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs
}

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) process.exit(r.status || 1)
}

function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const objDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-capture-'))
  try {
    if (process.platform === 'win32' && has('where', ['cl'])) {
      const { cmd, args } = compileCommand('msvc', SRC, OUT, objDir)
      run(cmd, args)
    } else if (process.platform === 'win32' && findVcvars()) {
      const { cmd, args } = compileCommand('msvc', SRC, OUT, objDir)
      const quoted = [cmd, ...args].map(a => (/[\s&()]/.test(a) ? `"${a}"` : a)).join(' ')
      run('cmd.exe', ['/d', '/s', '/c', `"call "${findVcvars()}" >nul && ${quoted}"`],
          { windowsVerbatimArguments: true })
    } else if (has(MINGW, ['--version'])) {
      const { cmd, args } = compileCommand('mingw', SRC, OUT)
      run(cmd, args)
    } else if (upToDate()) {
      console.warn(`No C++ compiler found; keeping the existing ${path.relative(ROOT, OUT)}.`)
      return
    } else {
      console.error(process.platform === 'win32'
        ? 'No C++ compiler found: install Visual Studio Build Tools (C++ workload) or mingw-w64.'
        : `No ${MINGW} found: install mingw-w64 (Arch: mingw-w64-gcc, Debian/Ubuntu: g++-mingw-w64-x86-64).`)
      process.exit(1)
    }
  } finally {
    fs.rmSync(objDir, { recursive: true, force: true })
  }
  console.log(`Built ${path.relative(ROOT, OUT)}`)
}

module.exports = { compileCommand, upToDate }

if (require.main === module) main()
