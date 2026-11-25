import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
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

const SWITCH = 'Let AI agents use Sonorus'
const ADDRESS = 'http://127.0.0.1:8000/mcp'
const COMMAND = 'claude mcp add --transport http --scope user sonorus http://127.0.0.1:8000/mcp'

async function setup(options: FixtureOptions = {}) {
  const bridge = createMockElectronAPI()
  await bridge.writeSettings(DEFAULT_SETTINGS)
  vi.stubGlobal('electronAPI', bridge)
  const client = createFixtureClient(options)
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  await userEvent.click(await findTitlebarButton('Settings'))
  const settings = await findDialog('Settings')
  await userEvent.click(within(settings).getByRole('tab', { name: 'Integrations' }))
  await within(settings).findByRole('heading', { name: 'Integrations' })
  return { bridge, client, settings }
}

const toggle = () => screen.getByRole('switch', { name: SWITCH })
const connect = () => screen.queryByRole('heading', { name: 'Connect Claude Code' })

test('off by default: the switch alone, nothing to connect to', async () => {
  await setup()
  await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))
  expect(connect()).toBeNull()
  expect(screen.queryByText(COMMAND)).toBeNull()
})

test('switched on: the backend keeps it and the way to connect shows', async () => {
  const { client } = await setup()
  await userEvent.click(toggle())
  await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
  expect(await client.getMcpEnabled()).toBe(true)
  expect(await screen.findByRole('heading', { name: 'Connect Claude Code' })).toBeTruthy()
  expect(screen.getByText(ADDRESS)).toBeTruthy()
  expect(screen.getByText(COMMAND)).toBeTruthy()
})

test('switched off again: the way to connect goes', async () => {
  const { client } = await setup()
  await client.setMcpEnabled(true)
  await userEvent.click(within(await findDialog('Settings')).getByRole('tab', { name: 'General' }))
  await userEvent.click(within(await findDialog('Settings')).getByRole('tab', { name: 'Integrations' }))
  await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
  await userEvent.click(toggle())
  await waitFor(() => expect(connect()).toBeNull())
  expect(await client.getMcpEnabled()).toBe(false)
})

test('copy puts the address or the command on the clipboard', async () => {
  const { bridge } = await setup()
  await userEvent.click(toggle())
  await userEvent.click(await screen.findByRole('button', { name: 'Copy the command' }))
  expect(bridge.clipboard()).toBe(COMMAND)
  expect(await screen.findByText('Copied')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Copy the address' }))
  expect(bridge.clipboard()).toBe(ADDRESS)
})

test('a switch the backend did not take goes back, with the reason', async () => {
  await setup({ overrides: { setMcpEnabled: async () => { throw new ApiError(500, 'Backend error') } } })
  await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))
  await userEvent.click(toggle())
  expect(await screen.findByText(/Could not turn on the MCP server/)).toBeTruthy()
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  expect(connect()).toBeNull()
})
