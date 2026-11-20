'use strict'

// A note written in the Notes tab with a heading, a list and a checkbox typed as
// "- [ ] " is there, rendered, after the app quits and starts again, even when it
// quits right after the typing, before the save a second later.

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
  await page.keyboard.type('- Ship the fix\n')
  // As in Obsidian: "[ ] " at the start of the next list item makes it a checkbox.
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

// Text selected across two turns goes into the note as a quote for each, with who
// said it and when; a chip takes the player there, and the time button puts where the
// player stands into the note.
test('Quote to notes, a chip that seeks and the player time', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const recording = 'Weekly sync'
  const notesOf = async () => {
    const { id } = (await api('GET', '/transcripts')).find(item => item.title === recording)
    return (await api('GET', `/transcripts/${id}/note`)).content
  }
  const main = page.getByRole('main', { name: 'Transcript' })
  const inspector = () => page.getByRole('region', { name: 'Inspector' })
  const player = page.getByRole('region', { name: 'Player' })
  await main.getByRole('heading', { name: recording }).waitFor()

  // A drag from the start of one paragraph to the end of the next one, another speaker's.
  const from = await main.getByText('The installers are ready for testing.').boundingBox()
  const to = await main.getByText('I can check them on my laptop today.').boundingBox()
  await page.mouse.move(from.x + 1, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width - 1, to.y + to.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Quote to notes' }).click()

  await assertEventually(async () => await inspector().getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected') === 'true',
    'the Notes tab opens')
  const quotes = inspector().locator('blockquote')
  await assertEventually(async () => await quotes.count() === 2, 'a quote for each turn')
  await quotes.nth(0).getByText('Mark Ellis').waitFor()
  await quotes.nth(0).getByText('The installers are ready for testing.').waitFor()
  await quotes.nth(1).getByText('Unknown speaker 1').waitFor()
  await quotes.nth(1).getByText('I can check them on my laptop today.').waitFor()
  await assertEventually(async () => JSON.stringify(await notesOf() ?? {}).includes('I can check them on my laptop today.'),
    'the note is saved')

  await quotes.nth(1).getByRole('button', { name: 'Go to 00:12' }).click()
  await player.getByText(/^00:12$/).first().waitFor()

  const time = inspector().getByRole('button', { name: 'Insert player time' })
  await assertEventually(async () => (await time.textContent()).trim() === '00:12', 'the button shows where the player stands')
  await time.click()
  await assertEventually(async () => (JSON.stringify(await notesOf() ?? {}).match(/"seconds":12/g) ?? []).length === 2,
    'the time is in the note, next to the quote that had it')
})
