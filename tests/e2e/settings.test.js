'use strict'

// The interface scale zooms the window and is saved; Reset puts it back.

const test   = require('node:test')
const assert = require('node:assert/strict')
const { startApp, savedSettings } = require('./harness')

test('the interface scale zooms the window, is saved, and Reset puts it back', async t => {
  const app = await startApp()
  t.after(app.stop)
  const { page } = app
  const zoom = () => app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
  await page.getByRole('heading', { name: 'Weekly sync' }).waitFor()

  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('tab', { name: 'Appearance' }).click()
  const scale = dialog.getByRole('slider')
  await scale.focus()
  await page.keyboard.press('ArrowRight')
  await assertEventually(async () => (await zoom()) > 1, 'the window zooms in')
  await assertEventually(async () => savedSettings(app.dataDir).scale > 100, 'the scale is saved')

  await dialog.getByRole('tab', { name: 'Data' }).click()
  await dialog.getByRole('button', { name: /^Reset/ }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: /Reset/ }).click()
  await assertEventually(async () => (await zoom()) === 1, 'the window is back to 100 %')
  assert.equal(savedSettings(app.dataDir).scale, 100)
})

async function assertEventually(check, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.fail(`${what} within ${timeoutMs / 1000} s`)
}
