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
