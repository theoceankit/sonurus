import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import tokens from '../../styles/tokens.css?raw'
import { TurnHeader } from './TurnHeader'
import css from './TurnHeader.module.css?raw'

const NAMED = { kind: 'named', name: 'Mark Ellis', color: 1 } as const

test('shows the avatar, the name and the time', () => {
  render(<TurnHeader speaker={NAMED} time="00:05" />)
  expect(screen.getByText('ME')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Mark Ellis' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Go to 00:05' }).textContent).toBe('00:05')
})

test.each([['unknown', 'Unknown speaker 1'], ['unassigned', 'Unassigned']] as const)('%s has the "?" avatar', (kind, name) => {
  render(<TurnHeader speaker={{ kind, name, color: 6 }} time="00:05" />)
  expect(screen.getByText('?')).toBeTruthy()
  expect(screen.getByRole('button', { name })).toBeTruthy()
})

test('a click on the name asks for the menu and says where to put it', async () => {
  const onOpenMenu = vi.fn()
  render(<TurnHeader speaker={NAMED} time="00:05" onOpenMenu={onOpenMenu} />)
  const name = screen.getByRole('button', { name: 'Mark Ellis' })
  await userEvent.click(name)
  expect(onOpenMenu).toHaveBeenCalledWith(name)
})

test('a click on the time seeks', async () => {
  const onSeek = vi.fn()
  render(<TurnHeader speaker={NAMED} time="00:05" onSeek={onSeek} />)
  await userEvent.click(screen.getByRole('button', { name: 'Go to 00:05' }))
  expect(onSeek).toHaveBeenCalledOnce()
})

test('open: the name says so', () => {
  render(<TurnHeader speaker={NAMED} time="00:05" open />)
  expect(screen.getByRole('button', { name: 'Mark Ellis' }).getAttribute('aria-expanded')).toBe('true')
})

test('its buttons take no stop of Tab', async () => {
  render(<TurnHeader speaker={NAMED} time="00:05" />)
  await userEvent.tab()
  expect(document.body).toBe(document.activeElement)
})

test('a name stays on one line of fixed height', () => {
  const rule = css.match(/\.label \{([^}]*)\}/)![1]
  expect(rule).toMatch(/white-space:\s*nowrap/)
  expect(rule).toMatch(/overflow-x:\s*clip/)
  expect(rule).toMatch(/text-overflow:\s*ellipsis/)
  expect(css.match(/\.name \{([^}]*)\}/)![1]).toMatch(/font:\s*var\(--font-body-strong\)/)
})

// Glyphs from a fallback font would make a line of normal height taller.
test('the font of the name sets its line height', () => {
  expect(tokens).toMatch(/--font-body-strong:[^;]*\/[\d.]+ /)
})
