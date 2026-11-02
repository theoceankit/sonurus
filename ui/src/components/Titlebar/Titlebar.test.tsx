import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { NOT_IMPLEMENTED_TOAST } from '../../not-implemented'
import { Titlebar } from './Titlebar'

const setup = (props = {}) => render(<OverlayProvider><Titlebar {...props} /></OverlayProvider>)

test('Toggle sidebar works and says whether the sidebar is open', async () => {
  const onToggleSidebar = vi.fn()
  setup({ sidebarOpen: false, onToggleSidebar })
  const button = screen.getByRole('button', { name: 'Toggle sidebar' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  await userEvent.click(button)
  expect(onToggleSidebar).toHaveBeenCalledOnce()
})

test('the inspector button shows only while the inspector is closed', async () => {
  const onOpenInspector = vi.fn()
  const { unmount } = setup({ inspectorOpen: true })
  expect(screen.queryByRole('button', { name: 'Show inspector' })).toBeNull()
  unmount()
  setup({ inspectorOpen: false, onOpenInspector })
  await userEvent.click(screen.getByRole('button', { name: 'Show inspector' }))
  expect(onOpenInspector).toHaveBeenCalledOnce()
})

test.each(['Back', 'Forward', 'New transcription', 'Speakers', 'Settings'])('%s says it is not available yet', async name => {
  setup()
  const button = screen.getByRole('button', { name })
  expect(button.getAttribute('aria-disabled')).toBe('true')
  await userEvent.click(button)
  expect((await screen.findAllByText(NOT_IMPLEMENTED_TOAST)).length).toBeGreaterThan(0)
})

test('search says it is not available yet and takes no text', async () => {
  setup()
  const field = screen.getByRole('searchbox', { name: 'Search transcripts' }) as HTMLInputElement
  await userEvent.click(field)
  expect((await screen.findAllByText(NOT_IMPLEMENTED_TOAST)).length).toBeGreaterThan(0)
  await userEvent.type(field, 'hello')
  expect(field.value).toBe('')
})

test('the working controls are not marked', () => {
  setup({ inspectorOpen: false })
  expect(screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('data-not-implemented')).toBeNull()
  expect(screen.getByRole('button', { name: 'Show inspector' }).getAttribute('data-not-implemented')).toBeNull()
})
