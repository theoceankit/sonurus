import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import type { ElectronSettings } from '../../platform/electron-api'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}, saved: Partial<ElectronSettings> = {}) {
  const client = createFixtureClient({ downloadStepMs: 5, ...options })
  const setZoom = vi.fn(async () => {})
  const bridge = createMockElectronAPI({ setZoom, getAppVersion: async () => '0.3.0' })
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  return { client, bridge, setZoom }
}

const openSettings = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  return screen.findByRole('dialog', { name: 'Settings' })
}
const openAppearance = async () => {
  const settings = await openSettings()
  await userEvent.click(within(settings).getByRole('tab', { name: 'Appearance' }))
  return settings
}
// A select is named by its label and its value.
const field = (name: string) => screen.getByRole('combobox', { name })
const option = (name: RegExp | string) => screen.getByRole('option', { name })

test('opens from the titlebar on General, with the sections at the side and the version under them', async () => {
  await setup()
  const settings = await openSettings()
  expect(within(settings).getByRole('tablist', { name: 'Settings sections' })).toBeTruthy()
  expect(within(settings).getByRole('tab', { name: 'General', selected: true })).toBeTruthy()
  expect(within(settings).getByRole('heading', { name: 'General' })).toBeTruthy()
  expect(await within(settings).findByText('Sonorus 0.3.0')).toBeTruthy()
})

test('Escape and the close button close it', async () => {
  await setup()
  await openSettings()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  await openSettings()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
})

test('the interface scale zooms and is saved once the slider lets go', async () => {
  const { bridge, setZoom } = await setup({}, { scale: 100 })
  await openAppearance()
  const slider = screen.getByRole('slider', { name: 'Interface scale' })
  expect(slider.getAttribute('aria-valuetext')).toBe('100%')
  fireEvent.keyDown(slider, { key: 'ArrowRight' })
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.05))
  await waitFor(async () => expect((await bridge.readSettings()).scale).toBe(105))
})

test('the transcription language is saved as picked', async () => {
  const { bridge } = await setup()
  await openSettings()
  await userEvent.click(field('Transcription language'))
  await userEvent.click(option(/English/))
  await waitFor(async () => expect((await bridge.readSettings()).transcribeLang).toBe('en'))
})

test('a language without its alignment model says so; Download starts it, with the progress and Cancel', async () => {
  const { client } = await setup({ downloadStepMs: 1000 }, { transcribeLang: 'cs' })
  const settings = await openSettings()
  const notice = await within(settings).findByRole('status')
  expect(notice.textContent).toContain('Alignment model for Czech is not installed')
  const start = vi.spyOn(client, 'startModelDownload')
  await userEvent.click(within(notice).getByRole('button', { name: 'Download (~1.3 GB)' }))
  expect(start).toHaveBeenCalledWith('cs', null)
  const status = () => within(settings).getByRole('status')
  await waitFor(() => expect(status().textContent).toContain('downloading 0%'))
  const cancel = vi.spyOn(client, 'cancelModelDownload')
  await userEvent.click(within(status()).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(cancel).toHaveBeenCalled())
  await waitFor(() => expect(within(status()).getByRole('button', { name: 'Download (~1.3 GB)' })).toBeTruthy())
})

test('a language whose alignment model is there says nothing', async () => {
  await setup({}, { transcribeLang: 'en' })
  const settings = await openSettings()
  await within(settings).findByRole('combobox', { name: 'Transcription language' })
  expect(within(settings).queryByRole('status')).toBeNull()
})

test('Start transcription is the queue\'s and changes it', async () => {
  const { client } = await setup()
  await openSettings()
  await waitFor(() => expect(field('Start transcription').textContent).toContain('Automatically'))
  await userEvent.click(field('Start transcription'))
  await userEvent.click(option('Manually'))
  await waitFor(async () => expect((await client.getQueue()).start_mode).toBe('manual'))
  expect(field('Start transcription').textContent).toContain('Manually')
})

test('Handle format is the backend\'s, shown by example, and changes it', async () => {
  const { client } = await setup()
  await client.setHandleFormat('first.l')
  const settings = await openSettings()
  expect(within(settings).getByText('Speakers')).toBeTruthy()
  await waitFor(() => expect(field('Handle format').textContent).toContain('@olivia.b'))
  await userEvent.click(field('Handle format'))
  expect(screen.getAllByRole('option').map(o => o.textContent?.trim())).toEqual(['@olivia.brown', '@o.brown', '@olivia.b'])
  await userEvent.click(option('@o.brown'))
  await waitFor(async () => expect(await client.getHandleFormat()).toBe('f.last'))
  expect(field('Handle format').textContent).toContain('@o.brown')
})

test('Appearance: the theme and the app language are there and not available yet', async () => {
  await setup()
  await openAppearance()
  expect(field('App language').closest('[data-not-implemented]')?.getAttribute('data-not-implemented')).toBe('settings.app-language')
  expect(field('Theme').closest('[data-not-implemented]')?.getAttribute('data-not-implemented')).toBe('settings.theme')
  expect(field('Theme').textContent).toContain('System')
})

test('opening puts the focus on the section, not on its first control', async () => {
  await setup()
  const settings = await openSettings()
  await waitFor(() => expect(document.activeElement).toBe(within(settings).getByRole('tab', { name: 'General' })))
})

test('a search over the sections is there and not available yet', async () => {
  await setup()
  const settings = await openSettings()
  const search = within(settings).getByRole('searchbox', { name: 'Search settings' })
  expect(search.closest('[data-not-implemented]')?.getAttribute('data-not-implemented')).toBe('settings.search')
})
