import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { dismissAllToasts } from '../Toast/toast'
import { OverlayProvider } from '../../OverlayProvider'
import { Inspector } from './Inspector'

afterEach(dismissAllToasts)

const panel = (props = {}) => render(<OverlayProvider><Inspector {...props}><p>content</p></Inspector></OverlayProvider>)

test('opens on Speakers, with its content', () => {
  panel()
  expect(screen.getByRole('tab', { name: 'Speakers' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('content')).toBeTruthy()
})

test.each(['Chapters', 'Notes'])('%s is not there yet: it says so and stays on Speakers', async name => {
  panel()
  const tab = screen.getByRole('tab', { name })
  expect(tab.getAttribute('aria-disabled')).toBe('true')
  await userEvent.click(tab)
  expect(screen.getByRole('tab', { name: 'Speakers' }).getAttribute('aria-selected')).toBe('true')
  expect(await screen.findByText('Not available yet')).toBeTruthy()
})

test('the button closes the panel', async () => {
  const onClose = vi.fn()
  panel({ onClose })
  await userEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('review off: no dock', () => {
  panel()
  expect(screen.queryByText('Review speakers')).toBeNull()
})

test('review on: the title, the counter and the card', () => {
  panel({ review: { mode: 'on', counter: '1 of 4', card: <p>card</p> } })
  expect(screen.getByText('Review speakers')).toBeTruthy()
  expect(screen.getByText('1 of 4')).toBeTruthy()
  expect(screen.getByText('card')).toBeTruthy()
})

test('review collapsed: how many are left, and Resume', async () => {
  const onResume = vi.fn()
  panel({ review: { mode: 'collapsed', left: 4, onResume } })
  expect(screen.getByText('4 left')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
  expect(onResume).toHaveBeenCalledOnce()
})
