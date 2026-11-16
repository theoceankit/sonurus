import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'
import { findDialog, findTitlebarButton } from '../../test-queries'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

const TRAY = 'Keep running in the tray when the window is closed'

async function setup({ trayAvailable = true, saved = {} }: { trayAvailable?: boolean; saved?: object } = {}) {
  const bridge = createMockElectronAPI({ getTrayAvailable: async () => trayAvailable })
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={createFixtureClient()}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  await userEvent.click(await findTitlebarButton('Settings'))
  const dialog = await findDialog('Settings')
  await userEvent.click(within(dialog).getByRole('tab', { name: 'General' }))
  return { bridge, dialog }
}

test('keeping Sonorus in the tray is on at first, and turning it off is saved', async () => {
  expect(DEFAULT_SETTINGS.closeToTray).toBe(true)
  const { bridge, dialog } = await setup()
  const toggle = await within(dialog).findByRole('switch', { name: TRAY })
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  expect((toggle as HTMLButtonElement).disabled).toBe(false)
  await userEvent.click(toggle)
  await waitFor(async () => expect((await bridge.readSettings()).closeToTray).toBe(false))
  expect(toggle.getAttribute('aria-checked')).toBe('false')
})

test('a saved choice is shown', async () => {
  const { dialog } = await setup({ saved: { closeToTray: false } })
  const toggle = await within(dialog).findByRole('switch', { name: TRAY })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
})

test('without a tray the switch is off and says why', async () => {
  const { dialog } = await setup({ trayAvailable: false })
  const toggle = await within(dialog).findByRole('switch', { name: TRAY })
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true))
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(within(dialog).getByText('The system has no tray: closing the window quits Sonorus.')).toBeTruthy()
})
