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
