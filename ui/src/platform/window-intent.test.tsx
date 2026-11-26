import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { Button } from '../components/Button/Button'
import { Modal } from '../components/Modal/Modal'
import { ModalBody } from '../components/ModalBody/ModalBody'
import { ModalHeader } from '../components/ModalHeader/ModalHeader'
import { TextField } from '../components/TextField/TextField'
import { OverlayProvider } from '../OverlayProvider'
import type { WindowIntent } from './electron-api'
import { createMockElectronAPI } from './electron-api-mock'
import { useWindowIntent } from './window-intent'

afterEach(() => vi.unstubAllGlobals())

function Window() {
  const [open, setOpen] = useState(false)
  useWindowIntent(() => setOpen(true))
  return (
    <OverlayProvider>
      <Button>In the page</Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalHeader title="New recording" />
        <ModalBody><TextField label="Title" /></ModalBody>
      </Modal>
    </OverlayProvider>
  )
}

// The tray menu and notifications are input the page never sees: whatever came last in
// the page says nothing of how this window was asked for. After a click in the page
// Chromium would draw no ring for a plain focus() on a button, so the window asks for
// it. jsdom does not work out :focus-visible, so what is checked is how the focus is given.
test('a window asked for from outside the page rings its first control after a click in the page', async () => {
  let intent: WindowIntent | null = null
  let waiting = () => {}
  vi.stubGlobal('electronAPI', createMockElectronAPI({
    takeWindowIntent: async () => { const taken = intent; intent = null; return taken },
    onWindowIntent: callback => { waiting = callback; return () => {} },
  }))
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  render(<Window />)
  await userEvent.click(screen.getByRole('button', { name: 'In the page' }))

  intent = { dialog: 'new-recording', app: null }
  act(() => waiting())

  const field = await screen.findByRole('textbox', { name: 'Title' })
  await waitFor(() => expect(document.activeElement).toBe(field))
  const calls = focus.mock.calls.filter((_, index) => focus.mock.contexts[index] === field)
  expect(calls.at(-1)?.[0]).toEqual({ focusVisible: true })
  focus.mockRestore()
})
