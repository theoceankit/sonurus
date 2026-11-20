'use strict'

// A note written in the Notes tab with a heading, a list and a checkbox is there,
// rendered, after the app quits and starts again, even when it quits right after
// the typing, before the save a second later.

const test   = require('node:test')
const assert = require('node:assert')
const { startApp, assertEventually, api } = require('./harness')

test('a note survives quitting the app right after typing', async t => {
  const app = await startApp()
  t.after(app.stop)
  let page = app.page
  const recording = 'Weekly sync'
  const notesOf = async () => {
    const { id } = (await api('GET', '/transcripts')).find(item => item.title === recording)
    return (await api('GET', `/transcripts/${id}/note`)).content
  }

  const inspector = () => page.getByRole('region', { name: 'Inspector' })
  await page.getByRole('main', { name: 'Transcript' }).getByRole('heading', { name: recording }).waitFor()
  await inspector().getByRole('tab', { name: 'Notes' }).click()
  const editor = inspector().getByRole('textbox', { name: 'Notes' })
  await editor.click()
  await page.keyboard.type('# Decisions\n')
  await page.keyboard.type('- Ship the fix\n\n')
  await page.keyboard.type('[ ] Write the notes')

  await assertEventually(async () => JSON.stringify(await notesOf() ?? {}).includes('Ship the fix'), 'the note is saved after typing stops')
  await page.keyboard.type(', then send them')
  page = await app.relaunch()

  assert.match(JSON.stringify(await notesOf()), /Write the notes, then send them/, 'saved when the app quit')
  await page.getByRole('main', { name: 'Transcript' }).getByRole('heading', { name: recording }).waitFor()
  await inspector().getByRole('tab', { name: 'Notes' }).click()
  await inspector().getByRole('heading', { level: 1, name: 'Decisions' }).waitFor()
  await inspector().getByRole('listitem').filter({ hasText: 'Ship the fix' }).waitFor()
  const box = inspector().getByRole('checkbox')
  assert.equal(await box.count(), 1)
  assert.equal(await box.isChecked(), false)
  await inspector().getByText('Write the notes, then send them', { exact: true }).waitFor()
})
