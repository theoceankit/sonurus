#!/usr/bin/env node
'use strict'

// Fails the build when the app archive lacks the built new UI or carries its
// sources or Storybook. Run after electron-builder:
//   node scripts/check-packaged-ui.js [dist]

const fs   = require('fs')
const path = require('path')

const REQUIRED  = '/ui/dist/index.html'
const FORBIDDEN = [/^\/ui\/(?!dist(\/|$))/, /\.stories\./, /storybook/i]

// files: archive paths as @electron/asar lists them, with a leading slash.
function packagedUiProblems(files) {
  const problems = files.filter(f => FORBIDDEN.some(re => re.test(f))).map(f => `must not be packaged: ${f}`)
  if (!files.includes(REQUIRED)) problems.unshift(`missing: ${REQUIRED}`)
  return problems
}

// dist/linux-unpacked/resources, dist/win-unpacked/resources,
// dist/mac-arm64/Sonorus.app/Contents/Resources
function findArchives(dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sub = path.join(dir, entry.name)
    if (fs.existsSync(path.join(sub, 'app.asar'))) found.push(path.join(sub, 'app.asar'))
    else found.push(...findArchives(sub))
  }
  return found
}

module.exports = { packagedUiProblems }

if (require.main === module) {
  const { listPackage } = require('@electron/asar')
  const dir = process.argv[2] || 'dist'
  const archives = findArchives(dir)
  if (!archives.length) {
    console.error(`No app.asar found in ${dir}`)
    process.exit(1)
  }
  let failed = false
  for (const archive of archives) {
    const files = listPackage(archive).map(f => f.split(path.sep).join('/'))
    const problems = packagedUiProblems(files)
    console.log(`${archive}: ${problems.length ? `${problems.length} problem(s)` : 'ok'}`)
    for (const p of problems) console.error(`::error::${p}`)
    failed = failed || problems.length > 0
  }
  process.exit(failed ? 1 : 0)
}
