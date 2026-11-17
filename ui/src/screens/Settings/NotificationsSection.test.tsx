import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import type { ElectronSettings, MicApp } from '../../platform/electron-api'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'
import { findDialog, findTitlebarButton } from '../../test-queries'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}, saved: Partial<ElectronSettings> = {}, apps: MicApp[] = []) {
  const bridge = createMockElectronAPI({ getMicApps: async () => apps })
  await bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
  vi.stubGlobal('electronAPI', bridge)
  render(<ApiProvider client={createFixtureClient(options)}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  await userEvent.click(await findTitlebarButton('Settings'))
  const settings = await findDialog('Settings')
  await userEvent.click(within(settings).getByRole('tab', { name: 'Notifications' }))
  await within(settings).findByRole('heading', { name: 'Notifications' })
  return { bridge, settings }
}

const toggle = (name: string) => screen.getByRole('switch', { name })
const field = (name: string) => screen.getByRole('combobox', { name })
const saved = async (bridge: { readSettings: () => Promise<ElectronSettings> }) => bridge.readSettings()

const ALL = 'Show notifications'
const START = 'Suggest recording when a call seems to start'
const APPS = 'Calls in'
const END = 'When a call seems to end'

test('everything is on by default: any app, suggest stopping', async () => {
  await setup()
  expect(toggle(ALL).getAttribute('aria-checked')).toBe('true')
  expect(toggle(START).getAttribute('aria-checked')).toBe('true')
  await waitFor(() => expect(field(APPS).textContent).toContain('Any app'))
  expect(field(END).textContent).toContain('Suggest stopping')
})

test('turning all notifications off saves it and turns the rest off with it', async () => {
  const { bridge } = await setup()
  await userEvent.click(toggle(ALL))
  await waitFor(async () => expect((await saved(bridge)).notifications).toBe(false))
  expect(toggle(START).hasAttribute('disabled')).toBe(true)
  expect(field(END).hasAttribute('disabled') || field(END).getAttribute('aria-disabled') === 'true' || field(END).hasAttribute('data-disabled')).toBe(true)
})

test('suggestions to start can be turned off on their own', async () => {
  const { bridge } = await setup()
  await userEvent.click(toggle(START))
  await waitFor(async () => expect((await saved(bridge)).promptStart).toBe(false))
  expect((await saved(bridge)).notifications).toBe(true)
})

test('selected apps lists the apps that used a microphone, and saves the ones picked', async () => {
  const { bridge } = await setup({}, {}, [{ id: 'discord', name: 'Discord' }, { id: 'firefox', name: 'Firefox' }])
  await userEvent.click(field(APPS))
  await userEvent.click(screen.getByRole('option', { name: 'Selected apps' }))
  await waitFor(async () => expect((await saved(bridge)).promptStartApps).toBe('selected'))
  await userEvent.click(await screen.findByRole('switch', { name: 'Discord' }))
  await waitFor(async () => expect((await saved(bridge)).promptStartSelected).toEqual(['discord']))
  expect(toggle('Firefox').getAttribute('aria-checked')).toBe('false')
})

test('with no app seen yet, selected apps says how the list fills', async () => {
  await setup({}, { promptStartApps: 'selected' })
  expect(await screen.findByText('Apps appear here once they use a microphone for a call.')).toBeTruthy()
})

test('a selected app that is no longer in the list stays, by its id', async () => {
  await setup({}, { promptStartApps: 'selected', promptStartSelected: ['zoom'] })
  expect((await screen.findByRole('switch', { name: 'zoom' })).getAttribute('aria-checked')).toBe('true')
})

test('the end of a call can stop the recording by itself', async () => {
  const { bridge } = await setup()
  await userEvent.click(field(END))
  await userEvent.click(screen.getByRole('option', { name: 'Stop recording automatically' }))
  await waitFor(async () => expect((await saved(bridge)).promptEnd).toBe('auto'))
})

test('where the system cannot tell that a call started, those settings are not available yet', async () => {
  await setup({ micWatch: { available: false, names: false } })
  await waitFor(() => expect(toggle(START).getAttribute('data-not-implemented')).toBe('settings.call-start-prompts'))
  expect(toggle(ALL).hasAttribute('data-not-implemented')).toBe(false)
  expect(field(END).hasAttribute('data-not-implemented')).toBe(false)
})

test('where the system does not name the app, a call ends only by silence', async () => {
  await setup({ micWatch: { available: true, names: false } })
  await screen.findByText('When another app has used a microphone for 15 seconds. This system does not say which app.')
  expect(toggle(START).hasAttribute('data-not-implemented')).toBe(false)
  expect(screen.getByText('During a recording: when nothing is heard for 5 minutes.')).toBeTruthy()
  expect(screen.queryByText(/let go of the microphone/)).toBeNull()
})
