import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import inspectorIcon from '../../assets/icons/inspector.svg?raw'
import toggleIcon from '../../assets/icons/sidebar-toggle.svg?raw'
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

// The hover of a panel's button moves the icon's second shape (panelLine in
// motion.module.css), so that shape has to stay the line of the panel's edge.
test.each([
  ['sidebar-toggle', toggleIcon, 'M9.75 6L9.75 18'],
  ['inspector', inspectorIcon, 'M14.25 6L14.25 18'],
])('the line that moves on hover is the second shape of %s', (_, icon, line) => {
  const shapes = [...icon.matchAll(/<(path|line|rect)\b[^>]*>/g)].map(m => m[0])
  expect(shapes).toHaveLength(2)
  expect(shapes[1]).toContain(`d="${line}"`)
})

test('after a click Toggle sidebar rests until the pointer leaves', async () => {
  setup({ sidebarOpen: true })
  const button = screen.getByRole('button', { name: 'Toggle sidebar' })
  expect(button.hasAttribute('data-settled')).toBe(false)
  await userEvent.click(button)
  expect(button.hasAttribute('data-settled')).toBe(true)
  await userEvent.unhover(button)
  expect(button.hasAttribute('data-settled')).toBe(false)
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

test('Show inspector plays its way out before it goes, and takes no click on the way', async () => {
  // jsdom runs no animations and has no getAnimations: here one is running.
  let finish = () => {}
  const finished = new Promise<void>(resolve => { finish = resolve })
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', { value: () => [{ finished }], configurable: true })
  try {
    const { rerender } = setup({ inspectorOpen: false })
    rerender(<OverlayProvider><Titlebar inspectorOpen /></OverlayProvider>)
    const button = screen.getByRole('button', { name: 'Show inspector', hidden: true })
    expect(button.hasAttribute('inert')).toBe(true)
    finish()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show inspector', hidden: true })).toBeNull())
  } finally {
    delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations
  }
})

test('the room of Show inspector stays and only opens or closes, so its neighbours can slide', () => {
  const { rerender } = setup({ inspectorOpen: false })
  const room = screen.getByRole('button', { name: 'Show inspector' }).parentElement!
  expect(room.hasAttribute('data-open')).toBe(true)
  rerender(<OverlayProvider><Titlebar inspectorOpen /></OverlayProvider>)
  expect(room.isConnected).toBe(true)
  expect(room.hasAttribute('data-open')).toBe(false)
})

test('with nothing to animate, Show inspector goes at once', async () => {
  const { rerender } = setup({ inspectorOpen: false })
  rerender(<OverlayProvider><Titlebar inspectorOpen /></OverlayProvider>)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Show inspector', hidden: true })).toBeNull())
})

test('New recording works', async () => {
  const onNewTranscription = vi.fn()
  setup({ onNewTranscription })
  await userEvent.click(screen.getByRole('button', { name: 'New recording' }))
  expect(onNewTranscription).toHaveBeenCalledOnce()
})

test('Settings works', async () => {
  const onOpenSettings = vi.fn()
  setup({ onOpenSettings })
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(onOpenSettings).toHaveBeenCalledOnce()
})

test('Speakers works', async () => {
  const onOpenSpeakers = vi.fn()
  setup({ onOpenSpeakers })
  await userEvent.click(screen.getByRole('button', { name: 'Speakers' }))
  expect(onOpenSpeakers).toHaveBeenCalledOnce()
})

test.each(['Back', 'Forward'])('%s says it is not available yet', async name => {
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
  expect(screen.getByRole('button', { name: 'New recording' }).getAttribute('data-not-implemented')).toBeNull()
  expect(screen.getByRole('button', { name: 'Speakers' }).getAttribute('data-not-implemented')).toBeNull()
})
