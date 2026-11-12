// Settings → Models opens the models folder in the file manager. Main asks the
// backend where it is: the renderer passes no path, so it cannot have main open
// anything else.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { showModelsFolder } = require(path.join(ROOT, 'electron', 'models-folder.js'))

function opener(result = '') {
  const opened = []
  return { opened, openPath: async p => { opened.push(p); return result } }
}

test('opens the folder the backend reports', async () => {
  const o = opener()
  const error = await showModelsFolder({ getFolder: async () => ({ path: '/data/.models', exists: true }), openPath: o.openPath })
  assert.equal(error, '')
  assert.deepEqual(o.opened, ['/data/.models'])
})

test('a folder that does not exist yet is not opened', async () => {
  const o = opener()
  const error = await showModelsFolder({ getFolder: async () => ({ path: '/data/.models', exists: false }), openPath: o.openPath })
  assert.match(error, /no models folder yet/i)
  assert.deepEqual(o.opened, [])
})

test('a backend that does not answer opens nothing', async () => {
  const o = opener()
  const error = await showModelsFolder({ getFolder: async () => { throw new Error('ECONNREFUSED') }, openPath: o.openPath })
  assert.match(error, /does not answer/i)
  assert.deepEqual(o.opened, [])
})

test('an answer without a path opens nothing', async () => {
  const o = opener()
  for (const answer of [null, {}, { path: 42, exists: true }, { path: '', exists: true }]) {
    assert.notEqual(await showModelsFolder({ getFolder: async () => answer, openPath: o.openPath }), '')
  }
  assert.deepEqual(o.opened, [])
})

test('the file manager failing is reported', async () => {
  const o = opener('Failed to open path')
  const error = await showModelsFolder({ getFolder: async () => ({ path: '/data/.models', exists: true }), openPath: o.openPath })
  assert.equal(error, 'Failed to open path')
})

test('the renderer passes no path: the preload method takes no arguments', () => {
  const preload = require('fs').readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8')
  assert.match(preload, /showModelsFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('show-models-folder'\)/)
})
