'use strict'

// A speaker renamed in the Speakers window is renamed in the transcript too.

const test = require('node:test')
const { startApp } = require('./harness')

test('a speaker renamed in the Speakers window has the new name in the transcript', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  await page.getByRole('heading', { name: 'Weekly sync' }).waitFor()

  await page.getByRole('banner').getByRole('button', { name: 'Speakers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Speakers' })
  await dialog.getByRole('button', { name: /Mark Ellis/ }).click()
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Mark Ellison')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await dialog.getByRole('button', { name: 'Save' }).and(page.locator('[disabled]')).waitFor()
  await dialog.getByRole('button', { name: 'Close' }).click()

  const text = page.getByRole('group', { name: 'Transcript text' })
  await text.getByRole('button', { name: 'Mark Ellison' }).first().waitFor()
})

// Merged into a named speaker, a speaker without a name is gone, and their turn in
// the transcript is the named speaker's.
test('a speaker merged into another is gone, and their turns are the other one\'s', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  await page.getByRole('heading', { name: 'Weekly sync' }).waitFor()
  const text = page.getByRole('group', { name: 'Transcript text' })
  await text.getByText('I can check them on my laptop today.').waitFor()
  await text.getByRole('button', { name: /Unknown speaker/ }).first().waitFor()

  await page.getByRole('banner').getByRole('button', { name: 'Speakers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Speakers' })
  await dialog.getByRole('button', { name: /Unnamed speaker/ }).click()
  await dialog.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Merge into another speaker' }).click()
  const picker = page.getByRole('dialog', { name: 'Merge Unnamed speaker into another speaker' })
  await picker.getByRole('option', { name: /Mark Ellis/ }).click()
  await picker.getByRole('button', { name: 'Merge' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Merge Unnamed speaker into "Mark Ellis"?' })
  await confirm.getByRole('button', { name: 'Merge' }).click()
  await dialog.getByRole('textbox', { name: 'Name' }).and(page.locator('[value="Mark Ellis"]')).waitFor()
  await dialog.getByRole('button', { name: 'Back to speakers' }).click()
  if (await dialog.getByRole('button', { name: /Unnamed speaker/ }).count() !== 0) throw new Error('the merged speaker is still listed')
  await dialog.getByRole('button', { name: 'Close' }).click()

  // The turn of the merged speaker joins Mark's turns around it.
  const turns = await text.getByRole('button', { name: /Mark Ellis|Unknown speaker/ }).allTextContents()
  if (turns.some(name => name.includes('Unknown speaker'))) throw new Error(`a turn is still unknown: ${turns}`)
})
