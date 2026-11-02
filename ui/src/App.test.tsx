import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ApiProvider } from './api/ApiProvider'
import { createFixtureClient } from './api/fixtures/fixture-client'
import { App } from './App'
import { OverlayProvider } from './OverlayProvider'

test('says so while the backend is away, and stops when it is back', async () => {
  const client = createFixtureClient()
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await screen.findByRole('region', { name: 'This week' })
  expect(screen.queryByText('Backend is not responding')).toBeNull()
  act(() => client.setConnected(false))
  expect(await screen.findByText('Backend is not responding')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'This week' })).toBeTruthy()
  act(() => client.setConnected(true))
  await waitFor(() => expect(screen.queryByText('Backend is not responding')).toBeNull())
})
