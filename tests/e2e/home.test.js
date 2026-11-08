'use strict'

// A first start: no recordings yet. The window says how to make one, and its
// link to the models opens Settings.

const test   = require('node:test')
const assert = require('node:assert/strict')
const { startApp } = require('./harness')

test('an empty library says how to make a transcription and leads to the models', async t => {
  const app = await startApp({ seed: 'empty' })
  t.after(app.stop)
  const { page } = app

  await page.getByText('No recordings yet').waitFor()
  await page.getByText('To make a new transcription, press').waitFor()
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 0)

  await page.getByRole('main').getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('tab', { name: 'Models', selected: true }).waitFor()
})
