'use strict'

// The newest recording opens at start. It plays, a turn changes speaker and
// back with Undo, and its title and text are edited.

const test   = require('node:test')
const assert = require('node:assert/strict')
const { startApp, api } = require('./harness')

test('the editor plays, changes a speaker with Undo, and edits the title and the text', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const main = page.getByRole('main', { name: 'Transcript' })
  const text = main.getByRole('group', { name: 'Transcript text' })
  const player = page.getByRole('region', { name: 'Player' })
  await main.getByRole('heading', { name: 'Weekly sync' }).waitFor()

  // Playing moves the clock; pausing stops it.
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await player.getByRole('button', { name: 'Pause', exact: true }).waitFor()
  await player.getByText(/^00:0[1-9]$/).first().waitFor()
  await player.getByRole('button', { name: 'Pause', exact: true }).click()

  // A turn of Mark Ellis goes to Anna Petrova, then back.
  await text.getByRole('button', { name: 'Mark Ellis' }).first().click()
  await page.getByRole('dialog', { name: 'Change speaker' }).getByRole('option', { name: /Anna Petrova/ }).click()
  await page.getByText('Assigned to Anna Petrova').waitFor()
  assert.equal(await text.getByRole('button', { name: 'Mark Ellis' }).count(), 1)
  await page.getByRole('region', { name: /Notifications/ }).getByRole('button', { name: 'Undo' }).click()
  await text.getByRole('button', { name: 'Mark Ellis' }).nth(1).waitFor()

  // The title, in the editor and in the list.
  await main.getByRole('heading', { level: 1 }).getByRole('button').click()
  await main.getByRole('textbox').fill('Weekly sync, week 45')
  await page.keyboard.press('Enter')
  await main.getByRole('heading', { name: 'Weekly sync, week 45' }).waitFor()
  await page.getByRole('complementary', { name: 'Recordings' }).getByText('Weekly sync, week 45').waitFor()

  // The text of one paragraph.
  await text.getByText('The installers are ready for testing.').hover()
  await text.getByRole('toolbar', { name: 'Paragraph' }).getByRole('button', { name: 'Edit' }).click()
  const field = text.getByRole('textbox')
  await field.fill('The installers are ready for review.')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await text.getByText('The installers are ready for review.').waitFor()

  const list = await api('GET', '/transcripts')
  const id = list.find(item => item.title === 'Weekly sync, week 45').id
  const saved = await api('GET', `/transcripts/${id}`)
  assert.ok(saved.segments.some(segment => segment.text === 'The installers are ready for review.'))
})
