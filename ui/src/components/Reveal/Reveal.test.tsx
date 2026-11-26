import { render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Reveal } from './Reveal'

test('shows its content while open, keeps it on the way out, then lets it go', async () => {
  const { rerender } = render(<Reveal open={false}><p>card</p></Reveal>)
  expect(screen.queryByText('card')).toBeNull()
  rerender(<Reveal open><p>card</p></Reveal>)
  expect(screen.getByText('card')).toBeTruthy()
  rerender(<Reveal open={false}><p>card</p></Reveal>)
  expect(screen.getByText('card').closest('[inert]')).toBeTruthy()
  await waitFor(() => expect(screen.queryByText('card')).toBeNull())
})

test('opened again on its way out, it stays', async () => {
  const { rerender } = render(<Reveal open><p>card</p></Reveal>)
  rerender(<Reveal open={false}><p>card</p></Reveal>)
  rerender(<Reveal open><p>card</p></Reveal>)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(screen.getByText('card').closest('[inert]')).toBeNull()
})

// A build writes 150ms as .15s.
test('stays for the whole of its way out, whatever unit the build gives the time', async () => {
  const root = document.documentElement.style
  for (const [token, value] of [['--duration-base', '.15s'], ['--duration-slow', '.2s'], ['--duration-move', '.25s']]) root.setProperty(token, value)
  try {
    const { rerender } = render(<Reveal open><p>card</p></Reveal>)
    rerender(<Reveal open={false}><p>card</p></Reveal>)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(screen.queryByText('card')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('card')).toBeNull())
  } finally {
    for (const token of ['--duration-base', '--duration-slow', '--duration-move']) root.removeProperty(token)
  }
})
