'use strict'

// A file goes into the queue, which waits on manual start: its settings change,
// then it is deleted again, and the original file stays where it was.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')
const { startApp, stubOpenFiles, api } = require('./harness')

test('an imported file waits in the queue, can be edited and deleted', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app

  const file = path.join(app.dataDir, 'import', 'Team call.wav')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(path.join(app.dataDir, 'recordings', 'design-review.wav'), file)
  await stubOpenFiles(app.app, [file])

  await page.getByRole('button', { name: 'New recording' }).click()
  await page.getByRole('dialog', { name: 'New recording' }).getByRole('button', { name: 'Import files' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import files' })
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await dialog.getByRole('list', { name: 'Files to import' }).getByText('Team call.wav').waitFor()
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  const queue = page.getByRole('region', { name: 'Transcription queue' })
  await queue.getByText('Paused').waitFor()
  await queue.getByRole('button', { name: 'Waiting Team call' }).waitFor()
  const [job] = (await api('GET', '/queue')).jobs
  assert.equal(job.whisper_model, 'small')
  assert.notEqual(job.audio_path, file, 'the queue works on its own copy')

  await queue.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Transcription settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Transcription settings' })
  await settings.getByRole('textbox', { name: 'Title' }).fill('Team call, Monday')
  await settings.getByRole('button', { name: 'Save' }).click()
  await queue.getByRole('button', { name: 'Waiting Team call, Monday' }).waitFor()

  await queue.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Delete from queue' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await queue.waitFor({ state: 'detached' })
  assert.deepEqual((await api('GET', '/queue')).jobs, [])
  assert.ok(fs.existsSync(file), 'the original file is kept')
})
