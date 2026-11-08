import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { NOT_IMPLEMENTED_TOAST } from '../../not-implemented'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(hfToken = '') {
  const bridge = createMockElectronAPI()
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, hfToken })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={createFixtureClient()}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  return bridge
}

async function openSection(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  const settings = await screen.findByRole('dialog', { name: 'Settings' })
  await userEvent.click(within(settings).getByRole('tab', { name }))
  return settings
}

test('the HuggingFace token is hidden until shown', async () => {
  await setup('hf_saved')
  const settings = await openSection('API Keys')
  const field = within(settings).getByLabelText('HuggingFace token', { selector: 'input' }) as HTMLInputElement
  expect(field.value).toBe('hf_saved')
  expect(field.type).toBe('password')
  await userEvent.click(within(settings).getByRole('button', { name: 'Show token' }))
  expect(field.type).toBe('text')
  await userEvent.click(within(settings).getByRole('button', { name: 'Hide token' }))
  expect(field.type).toBe('password')
})

test('the token is saved without spaces around it once the field is left', async () => {
  const bridge = await setup()
  const settings = await openSection('API Keys')
  const field = within(settings).getByLabelText('HuggingFace token', { selector: 'input' }) as HTMLInputElement
  await userEvent.type(field, '  hf_new ')
  expect((await bridge.readSettings()).hfToken).toBe('')
  await userEvent.tab()
  await waitFor(async () => expect((await bridge.readSettings()).hfToken).toBe('hf_new'))
  expect(field.value).toBe('hf_new')
})

test('Enter saves the token too', async () => {
  const bridge = await setup()
  const settings = await openSection('API Keys')
  await userEvent.type(within(settings).getByLabelText('HuggingFace token', { selector: 'input' }), 'hf_x{Enter}')
  await waitFor(async () => expect((await bridge.readSettings()).hfToken).toBe('hf_x'))
})

test('closing Settings with Escape saves the token typed', async () => {
  const bridge = await setup()
  const settings = await openSection('API Keys')
  await userEvent.type(within(settings).getByLabelText('HuggingFace token', { selector: 'input' }), ' hf_esc ')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  await waitFor(async () => expect((await bridge.readSettings()).hfToken).toBe('hf_esc'))
})

test('a token left as it was is not written again on closing', async () => {
  const bridge = await setup('hf_saved')
  await openSection('API Keys')
  const write = vi.spyOn(bridge, 'writeSettings')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  expect(write).not.toHaveBeenCalled()
})

test('Export is shown and not available yet; its controls change nothing', async () => {
  const bridge = await setup()
  const settings = await openSection('Export')
  const card = within(settings).getByRole('region', { name: 'Export' })
  expect(card.closest('[data-not-implemented]')?.getAttribute('data-not-implemented')).toBe('settings.export')
  const toggle = within(card).getByRole('switch', { name: 'Bookmarks' })
  await userEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect((await screen.findAllByText(NOT_IMPLEMENTED_TOAST)).length).toBeGreaterThan(0)
  expect((await bridge.readSettings()).exportFormat).toBe('txt')
})
