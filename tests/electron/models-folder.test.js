// Settings → Models opens the models folder in the file manager. Main asks the
// backend where it is: the renderer passes no path, so it cannot have main open
// anything else. Main still checks the answer, so whatever holds the port cannot
// have it open a file or another folder either.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { showModelsFolder } = require(path.join(ROOT, 'electron', 'models-folder.js'))

function opener(result = '') {
  const opened = []
  return { opened, openPath: async p => { opened.push(p); return result } }
}

// A data directory with a real .models folder in it.
function dataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-models-folder-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, '.models'))
  return dir
}

const answers = folder => async () => folder

test('opens the folder the backend reports', async t => {
  const models = path.join(dataDir(t), '.models')
  const o = opener()
  const error = await showModelsFolder({ getFolder: answers({ path: models, exists: true }), openPath: o.openPath })
  assert.equal(error, '')
  assert.deepEqual(o.opened, [models])
})

test('a folder that does not exist yet is not opened', async t => {
  const models = path.join(dataDir(t), '.models')
  const o = opener()
  const error = await showModelsFolder({ getFolder: answers({ path: models, exists: false }), openPath: o.openPath })
  assert.match(error, /no models folder yet/i)
  assert.deepEqual(o.opened, [])
})

test('a folder the backend says exists but is not on disk is not opened', async t => {
  const missing = path.join(dataDir(t), 'gone', '.models')
  const o = opener()
  const error = await showModelsFolder({ getFolder: answers({ path: missing, exists: true }), openPath: o.openPath })
  assert.notEqual(error, '')
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
    assert.notEqual(await showModelsFolder({ getFolder: answers(answer), openPath: o.openPath }), '')
  }
  assert.deepEqual(o.opened, [])
})

// shell.openPath runs a file with its default application: only the models folder may be opened.
test('a path that is not a .models folder is not opened', async t => {
  const dir = dataDir(t)
  const file = path.join(dir, '.models', 'run.sh')
  fs.writeFileSync(file, '#!/bin/sh\n')
  const fileNamedModels = path.join(dir, 'other', '.models')
  fs.mkdirSync(path.dirname(fileNamedModels))
  fs.writeFileSync(fileNamedModels, '')
  const o = opener()
  for (const p of [
    file,                                          // a file in the folder
    fileNamedModels,                               // a file named .models
    dir,                                           // another folder
    `${dir}${path.sep}.models${path.sep}..`,       // the right name, then out of it
    '.models',                                     // relative
  ]) {
    const error = await showModelsFolder({ getFolder: answers({ path: p, exists: true }), openPath: o.openPath })
    assert.notEqual(error, '', p)
  }
  assert.deepEqual(o.opened, [])
})

test('the file manager failing is reported', async t => {
  const models = path.join(dataDir(t), '.models')
  const o = opener('Failed to open path')
  const error = await showModelsFolder({ getFolder: answers({ path: models, exists: true }), openPath: o.openPath })
  assert.equal(error, 'Failed to open path')
})

test('the renderer passes no path: the preload method takes no arguments', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8')
  assert.match(preload, /showModelsFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('show-models-folder'\)/)
})
