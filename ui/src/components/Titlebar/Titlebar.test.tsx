import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

test('Back and Forward go where they can', async () => {
  const onBack = vi.fn()
  const onForward = vi.fn()
  setup({ canGoBack: true, canGoForward: true, onBack, onForward })
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  await userEvent.click(screen.getByRole('button', { name: 'Forward' }))
  expect(onBack).toHaveBeenCalledOnce()
  expect(onForward).toHaveBeenCalledOnce()
})

test('Back and Forward are off with nowhere to go, as they are by default', async () => {
  const onBack = vi.fn()
  setup({ canGoForward: true, onBack })
  const back = screen.getByRole('button', { name: 'Back' })
  expect(back.getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull()
  await userEvent.click(back)
  expect(onBack).not.toHaveBeenCalled()
  setup()
  expect(screen.getAllByRole('button', { name: 'Forward' }).at(-1)!.getAttribute('aria-disabled')).toBe('true')
})

// A button that turned off under the keyboard keeps the focus, so Tab goes on from
// it rather than from the top of the window. Chromium drops the focus of a button that
// becomes disabled, jsdom does not, so the button must not become disabled at all.
test.each([
  ['Back', 'Forward'],
  ['Forward', 'New recording'],
])('%s pressed from the keyboard at the last step keeps the focus', async (name, next) => {
  function History() {
    const [step, setStep] = useState(name === 'Back' ? 1 : 0)
    return <Titlebar canGoBack={step > 0} canGoForward={step < 1} onBack={() => setStep(0)} onForward={() => setStep(1)} />
  }
  render(<OverlayProvider><History /></OverlayProvider>)
  const button = screen.getByRole('button', { name })
  button.focus()
  await userEvent.keyboard('{Enter}')
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(document.activeElement).toBe(button)
  await userEvent.keyboard(' ')
  expect(document.activeElement).toBe(button)
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: next }))
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
  expect(screen.getByRole('button', { name: 'Back' }).getAttribute('data-not-implemented')).toBeNull()
  expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('data-not-implemented')).toBeNull()
  expect(screen.getByRole('button', { name: 'Show inspector' }).getAttribute('data-not-implemented')).toBeNull()
  expect(screen.getByRole('button', { name: 'New recording' }).getAttribute('data-not-implemented')).toBeNull()
  expect(screen.getByRole('button', { name: 'Speakers' }).getAttribute('data-not-implemented')).toBeNull()
})
