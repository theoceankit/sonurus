import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { OverlayProvider } from '../../OverlayProvider'
import { EditorScreen } from '../Editor/EditorScreen'
import { SettingsProvider } from '../Settings/SettingsProvider'

afterEach(dismissAllToasts)

const setup = (options: FixtureOptions) => render(
  <ApiProvider client={createFixtureClient(options)}><OverlayProvider><SettingsProvider><EditorScreen /></SettingsProvider></OverlayProvider></ApiProvider>,
)
const centre = () => screen.getByRole('main', { name: 'Transcript' })
const HINT = /To make a new transcription, press/

test('with no recordings the centre says how to make one and where the models are', async () => {
  setup({ scenario: 'empty' })
  expect(await within(centre()).findByText(HINT)).toBeTruthy()
  expect(within(centre()).getByRole('img', { name: 'plus' })).toBeTruthy()
  await userEvent.click(within(centre()).getByRole('button', { name: 'Settings' }))
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
})

test('loading the list is not empty', async () => {
  setup({ scenario: 'loading' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(within(centre()).queryByText(HINT)).toBeNull()
})

test('a backend that fails is not empty', async () => {
  setup({ scenario: 'error' })
  await screen.findByText('Could not load recordings')
  expect(within(centre()).queryByText(HINT)).toBeNull()
})

test('with recordings one is open instead', async () => {
  setup({})
  expect(await within(centre()).findByRole('heading', { level: 1 })).toBeTruthy()
  expect(within(centre()).queryByText(HINT)).toBeNull()
})
