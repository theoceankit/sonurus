import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test } from 'vitest'
import { Modal } from '../Modal/Modal'
import { Toaster } from './Toast'
import { dismissAllToasts, toast } from './toast-store'

afterEach(() => { act(() => dismissAllToasts()) })

// Radix draws a toast as a dismissable layer too: one that came after a modal is the
// top layer, and Escape went to it first.
function Windows({ count = 1 }: { count?: number }) {
  const [open, setOpen] = useState(count)
  return (
    <>
      {open >= 1 && (
        <Modal open onOpenChange={next => { if (!next) setOpen(0) }}>
          <p>First window</p>
          <button type="button">In the first</button>
        </Modal>
      )}
      {count >= 2 && open >= 2 && (
        <Modal open onOpenChange={next => { if (!next) setOpen(1) }}>
          <p>Second window</p>
          <button type="button">In the second</button>
        </Modal>
      )}
      <Toaster />
    </>
  )
}

const shown = (message: string) => screen.queryAllByText(message).some(el => !el.closest('[data-radix-toast-announce-exclude]') && el.closest('li'))
const show = (message: string) => act(() => { toast({ message, duration: 60_000 }) })

test('with a modal open, Escape closes the modal and the toast stays', async () => {
  render(<Windows />)
  await screen.findByText('First window')
  show('Saved')
  expect(shown('Saved')).toBe(true)
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('First window')).toBeNull())
  expect(shown('Saved')).toBe(true)
})

test('with two modals, Escape closes the one on top', async () => {
  render(<Windows count={2} />)
  await screen.findByText('Second window')
  show('Saved')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('Second window')).toBeNull())
  expect(screen.getByText('First window')).toBeTruthy()
  expect(shown('Saved')).toBe(true)
})

test('without a modal, Escape closes the toast', async () => {
  render(<Toaster />)
  show('Saved')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(shown('Saved')).toBe(false))
})
