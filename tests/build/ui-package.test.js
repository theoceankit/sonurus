'use strict'

// The new UI (ui/) keeps the old UI's security settings when packaged, is part
// of every build, and leaves its sources and Storybook out of the installers.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { packagedUiProblems } = require(path.join(ROOT, 'scripts', 'check-packaged-ui.js'))

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const pkg  = JSON.parse(read('package.json'))
const csp  = html => html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1]

// The one difference: the new UI plays audio from the backend, the old one from file://.
const NEW_UI_CSP = csp(read('electron', 'renderer', 'index.html')).replace("media-src 'self' file: blob:", "media-src 'self' http://localhost:8000 blob:")

test('the new UI has the CSP of the old one, with audio from the backend and not from files', () => {
  assert.equal(csp(read('ui', 'index.html')), NEW_UI_CSP)
  assert.doesNotMatch(NEW_UI_CSP, /file:/)
})

test('a build that exists has the same CSP too: the dev server additions stay out', { skip: !fs.existsSync(path.join(ROOT, 'ui', 'dist', 'index.html')) }, () => {
  assert.equal(csp(read('ui', 'dist', 'index.html')), NEW_UI_CSP)
})

test('the dev server additions apply to the dev server only', () => {
  const vite = read('ui', 'vite.config.ts')
  assert.match(vite, /apply: 'serve'/)
  assert.match(vite, /base: '\.\/'/)
})

test('fonts stay files: the CSP allows no data: URLs', () => {
  assert.match(read('ui', 'vite.config.ts'), /assetsInlineLimit: 0/)
})

test('a build that exists carries Inter as two files with its licence', { skip: !fs.existsSync(path.join(ROOT, 'ui', 'dist')) }, () => {
  const assets = fs.readdirSync(path.join(ROOT, 'ui', 'dist', 'assets'))
  assert.equal(assets.filter(f => /^Inter-(Regular|SemiBold)-.*\.woff2$/.test(f)).length, 2)
  assert.ok(fs.existsSync(path.join(ROOT, 'ui', 'dist', 'licenses', 'Inter-LICENSE.txt')))
  for (const file of assets.filter(f => /\.(css|js)$/.test(f))) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'ui', 'dist', 'assets', file), 'utf8'), /url\(["']?data:font/, file)
  }
})

test('Storybook telemetry is off', () => {
  assert.match(read('ui', '.storybook', 'main.ts'), /disableTelemetry: true/)
  assert.match(JSON.parse(read('ui', 'package.json')).scripts.storybook, /--no-version-updates/)
})

test('every component has stories', () => {
  const components = path.join(ROOT, 'ui', 'src', 'components')
  for (const e of fs.readdirSync(components, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const stories = path.join(components, e.name, `${e.name}.stories.tsx`)
    assert.ok(fs.existsSync(stories), `missing ${path.relative(ROOT, stories)}`)
  }
})

test('the new UI sources contain no remote content', () => {
  const sources = [path.join(ROOT, 'ui', 'index.html')]
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else sources.push(p)
    }
  }
  walk(path.join(ROOT, 'ui', 'src'))
  for (const file of sources) {
    const urls = (fs.readFileSync(file, 'utf8').match(/https?:\/\/[^\s'"`)]+/g) || [])
      .filter(u => !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) && !u.startsWith('http://www.w3.org/'))
    assert.deepEqual(urls, [], file)
  }
})

test('only the build of the new UI is packaged', () => {
  assert.ok(pkg.build.files.includes('ui/dist/**/*'))
  assert.ok(!pkg.build.files.some(f => f === 'ui/**/*' || f === 'ui/**'))
  assert.ok(pkg.build.files.includes('electron/**/*'))
  assert.equal(pkg.dependencies.react, undefined, 'React is bundled into ui/dist')
})

test('every build script and CI job builds the new UI first', () => {
  for (const name of ['build:mac', 'build:win', 'build:linux', 'build:all']) {
    assert.match(pkg.scripts[name], /npm run build:ui && .*electron-builder/, name)
  }
  const workflow = read('.github', 'workflows', 'build.yml')
  const count = re => (workflow.match(re) || []).length
  const jobs = count(/npx electron-builder /g)
  assert.equal(jobs, 3)
  assert.equal(count(/npm --prefix ui ci/g), jobs)
  assert.equal(count(/npm run build:ui/g), jobs)
  assert.equal(count(/node scripts\/check-packaged-ui\.js dist/g), jobs)
})

test('CI runs the type check and the unit tests of the new UI', () => {
  const workflow = read('.github', 'workflows', 'tests.yml')
  assert.match(workflow, /npm --prefix ui ci/)
  assert.match(workflow, /npm --prefix ui run typecheck/)
  assert.match(workflow, /npm --prefix ui test/)
})

test('the type generator stays a tool of its own and CI checks its output', () => {
  const ui = JSON.parse(read('ui', 'package.json'))
  const tool = JSON.parse(read('ui', 'tools', 'openapi-types', 'package.json'))
  assert.equal(ui.devDependencies['openapi-typescript'], undefined)
  assert.equal(ui.dependencies?.['openapi-typescript'], undefined)
  assert.ok(tool.devDependencies['openapi-typescript'])
  assert.match(read('.github', 'workflows', 'tests.yml'), /npm --prefix ui\/tools\/openapi-types run check/)
})

test('the type of the Electron bridge lists what the preload script exposes', () => {
  const body = read('electron', 'preload.js').match(/exposeInMainWorld\('electronAPI', \{([\s\S]*?)\n\}\)/)[1]
  const exposed = [...body.matchAll(/^\s*(\w+):/gm)].map(m => m[1]).sort()
  const type = read('ui', 'src', 'platform', 'electron-api.ts').match(/type ElectronAPI = \{([\s\S]*?)\n\}/)[1]
  const declared = [...type.matchAll(/^\s*(\w+):/gm)].map(m => m[1]).sort()
  assert.ok(exposed.length > 0)
  assert.deepEqual(declared, exposed)
})

test('a build that exists carries no fixtures', { skip: !fs.existsSync(path.join(ROOT, 'ui', 'dist', 'assets')) }, () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'ui', 'dist', 'assets')).filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(read('ui', 'dist', 'assets', file), /Weekly product sync|createFixtureClient/, file)
  }
})

test('the archive check accepts the build alone', () => {
  // The archive lists directories as well as files.
  assert.deepEqual(packagedUiProblems(['/package.json', '/electron/main.js', '/ui', '/ui/dist', '/ui/dist/assets', '/ui/dist/index.html', '/ui/dist/assets/index.js']), [])
})

test('the archive check reports a missing build', () => {
  assert.deepEqual(packagedUiProblems(['/package.json', '/electron/main.js']), ['missing: /ui/dist/index.html'])
})

test('the archive check reports sources and Storybook', () => {
  for (const file of ['/ui/src/main.tsx', '/ui/package.json', '/ui/.storybook/main.ts', '/ui/node_modules/react/index.js',
    '/ui/tools/openapi-types/package.json',
    '/ui/dist/Button.stories.js', '/node_modules/storybook/index.js']) {
    assert.deepEqual(packagedUiProblems(['/ui/dist/index.html', file]), [`must not be packaged: ${file}`])
  }
})
