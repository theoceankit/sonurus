import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

function setup(options: FixtureOptions = {}, platform = 'linux') {
  const client = createFixtureClient({ downloadStepMs: 5, ...options })
  const restartBackend = vi.fn(async () => {})
  vi.stubGlobal('electronAPI', createMockElectronAPI({ getPlatform: async () => platform, restartBackend }))
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  return { client, restartBackend }
}

const settings = () => screen.getByRole('dialog', { name: 'Settings' })
async function openSettings() {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return screen.findByRole('dialog', { name: 'Settings' })
}

test('GPU comes after Alignment; a development build only says what the backend runs on', async () => {
  setup({ gpu: { blocked_reason: 'not_packaged', device: 'cuda', torch: '2.8.0+cu128' } })
  await openSettings()
  const tabs = within(settings()).getAllByRole('tab').map(tab => tab.textContent!.trim())
  expect(tabs.slice(-2)).toEqual(['Alignment', 'GPU'])
  await userEvent.click(within(settings()).getByRole('tab', { name: 'GPU' }))
  const card = await within(settings()).findByRole('region', { name: 'GPU acceleration' })
  expect(card.textContent).toContain('Development build')
  expect(card.textContent).toContain('Running on GPU')
  expect(within(card).queryByRole('button')).toBeNull()
})

test('download, install, restart and on, with the restart of the app', async () => {
  const { restartBackend } = setup({ downloadStepMs: 10 })
  await openSettings()
  await userEvent.click(within(settings()).getByRole('tab', { name: 'GPU' }))
  const card = await within(settings()).findByRole('region', { name: 'GPU acceleration' })
  expect(card.textContent).toContain('NVIDIA GeForce RTX 4060, driver 615.78.08')
  await userEvent.click(within(card).getByRole('button', { name: 'Download (3.9 GB)' }))
  expect(await within(card).findByRole('progressbar', { name: 'GPU download' })).toBeTruthy()
  await waitFor(() => expect(restartBackend).toHaveBeenCalledOnce(), { timeout: 2000 })
  expect(await screen.findByText('GPU acceleration is on')).toBeTruthy()
  await waitFor(() => expect(card.textContent).toContain('Running on GPU'))
  expect(within(card).getByRole('button', { name: 'Remove' })).toBeTruthy()
})

test('no GPU section on macOS', async () => {
  setup({ gpu: { blocked_reason: 'unsupported_platform', gpu: null } }, 'darwin')
  await openSettings()
  await waitFor(() => expect(within(settings()).queryByRole('tab', { name: 'GPU' })).toBeNull())
})
