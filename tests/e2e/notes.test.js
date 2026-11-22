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
test('Quote, a chip that seeks and the player time', async t => {
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
  await page.getByRole('toolbar', { name: 'Selected text' }).getByRole('button', { name: 'Quote' }).click()

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
  await time.click()
  await assertEventually(async () => (JSON.stringify(await notesOf() ?? {}).match(/"seconds":12/g) ?? []).length === 2,
    'the time is in the note, next to the quote that had it')
})

// @ offers the speakers of the recording; Enter mentions the one found, or, with no
// one found, the name as typed. A speaker is kept by id, a person by name.
test('mentions with @', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const recording = 'Weekly sync'
  const notesOf = async () => {
    const { id } = (await api('GET', '/transcripts')).find(item => item.title === recording)
    return (await api('GET', `/transcripts/${id}/note`)).content
  }
  const mark = (await api('GET', '/speakers')).find(speaker => speaker.name === 'Mark Ellis').id
  const inspector = () => page.getByRole('region', { name: 'Inspector' })
  await page.getByRole('main', { name: 'Transcript' }).getByRole('heading', { name: recording }).waitFor()
  await inspector().getByRole('tab', { name: 'Notes' }).click()
  await inspector().getByRole('textbox', { name: 'Notes' }).click()

  await page.keyboard.type('Ask @mar')
  const list = page.getByRole('listbox', { name: 'Mention' })
  await list.getByRole('group', { name: 'In this recording' }).getByRole('option', { name: /Mark Ellis/ }).waitFor()
  await page.keyboard.press('Enter')
  await list.waitFor({ state: 'detached' })
  await page.keyboard.type('and @Sam from support')
  await list.getByRole('option', { name: 'Mention "Sam from support"' }).waitFor()
  await page.keyboard.press('Enter')

  await inspector().getByText('Mark Ellis', { exact: true }).waitFor()
  await inspector().getByText('Sam from support', { exact: true }).waitFor()
  await assertEventually(async () => {
    const saved = JSON.stringify(await notesOf() ?? {})
    return saved.includes(`"id":"${mark}"`) && saved.includes('"kind":"person"') && saved.includes('Sam from support')
  }, 'the note keeps the speaker by id and the person by name')
})

// Layout, which unit tests do not see: in the tab and expanded, the two sizes of the text.
test('a checkbox stands level with its text', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const inspector = page.getByRole('region', { name: 'Inspector' })
  const offset = () => page.getByRole('textbox', { name: 'Notes' }).locator('li').first().evaluate(item => {
    const box = item.querySelector('input').getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(item.querySelector('p'))
    const line = range.getClientRects()[0]
    return Math.abs((box.top + box.height / 2) - (line.top + line.height / 2))
  })

  await inspector.getByRole('tab', { name: 'Notes' }).click()
  await inspector.getByRole('textbox', { name: 'Notes' }).click()
  await page.keyboard.type('Send the draft')
  await inspector.getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: 'Checkbox' }).click()
  assert.ok(await offset() <= 0.5, `in the tab, ${await offset()} px off`)
  await inspector.getByRole('button', { name: 'Expand notes' }).click()
  await page.getByRole('main', { name: 'Transcript' }).getByRole('textbox', { name: 'Notes' }).waitFor()
  assert.ok(await offset() <= 0.5, `expanded, ${await offset()} px off`)
})

// The check of the chosen style takes room from its name, which is never cut.
test('the text style menu shows each style in full', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const inspector = page.getByRole('region', { name: 'Inspector' })
  await inspector.getByRole('tab', { name: 'Notes' }).click()
  await inspector.getByRole('textbox', { name: 'Notes' }).click()
  await page.keyboard.type('Agenda')
  const trigger = inspector.getByRole('toolbar', { name: 'Format' }).getByRole('button', { name: 'Text style' })
  for (const style of ['Heading 1', 'Heading 2', 'Heading 3', 'Plain text']) {
    await trigger.click()
    await page.getByRole('menuitemradio', { name: style }).click()
    await page.getByRole('menu').waitFor({ state: 'detached' })
    await trigger.click()
    const chosen = page.getByRole('menuitemradio', { name: style, checked: true })
    await chosen.waitFor()
    const cut = await chosen.evaluate(row => [row, ...row.querySelectorAll('*')]
      .some(element => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).textOverflow === 'ellipsis'))
    assert.equal(cut, false, `${style} is cut`)
    await page.keyboard.press('Escape')
    await page.getByRole('menu').waitFor({ state: 'detached' })
  }
})

// At a fractional scale the two edges round apart when they only touch.
test('the arrow of a tooltip overlaps its plate', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const inspector = page.getByRole('region', { name: 'Inspector' })
  await inspector.getByRole('tab', { name: 'Notes' }).click()
  const bar = inspector.getByRole('toolbar', { name: 'Format' })
  for (const [name, side] of [['Quote', 'top'], ['Close inspector', 'bottom']]) {
    await page.mouse.move(5, 500)
    await (name === 'Quote' ? bar : inspector).getByRole('button', { name, exact: true }).hover()
    const tooltip = page.locator(`[data-radix-popper-content-wrapper] [data-side="${side}"]`)
    await tooltip.waitFor()
    const overlap = await tooltip.evaluate((element, onTop) => {
      const plate = element.querySelector('span').getBoundingClientRect()
      const arrow = element.querySelector('svg').getBoundingClientRect()
      return onTop ? plate.bottom - arrow.top : arrow.bottom - plate.top
    }, side === 'top')
    assert.ok(overlap >= 0.9, `${name}: the arrow goes ${overlap} px into the plate`)
    await page.mouse.move(5, 500)
    if (side === 'top') await tooltip.waitFor({ state: 'detached' })
  }
})
