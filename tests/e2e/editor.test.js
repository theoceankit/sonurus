'use strict'

// The newest recording opens at start. It plays, a turn changes speaker and
// back with Undo, and its title and text are edited.
//
// The toast of a new speaker renders a moment before the transcript that
// changed with it, and edited titles and text show before the backend has
// them: what follows them is awaited, never read at once.

const test   = require('node:test')
const { startApp, assertEventually, api } = require('./harness')

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
  // Radix also puts the toast's text in a live region outside the toasts for a second.
  const toasts = page.getByRole('region', { name: /Notifications/ })
  await toasts.getByText('Assigned to Anna Petrova').waitFor()
  await assertEventually(async () => await text.getByRole('button', { name: 'Mark Ellis' }).count() === 1,
    'one turn of Mark Ellis is left')
  await toasts.getByRole('button', { name: 'Undo' }).click()
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

  await assertEventually(async () => {
    const saved = (await api('GET', '/transcripts')).find(item => item.title === 'Weekly sync, week 45')
    if (!saved) return false
    const { segments } = await api('GET', `/transcripts/${saved.id}`)
    return segments.some(segment => segment.text === 'The installers are ready for review.')
  }, 'the backend has the new title and text')
})
