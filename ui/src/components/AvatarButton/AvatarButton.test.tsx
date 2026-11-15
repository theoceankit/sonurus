import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { AvatarButton } from './AvatarButton'
import css from './AvatarButton.module.css?raw'

test('a button named by its label, with the avatar inside', async () => {
  const onClick = vi.fn()
  render(<AvatarButton speaker={{ name: 'Anna Petrova', color: 1 }} label="Add photo" onClick={onClick} />)
  const button = screen.getByRole('button', { name: 'Add photo' })
  expect(button.textContent).toContain('AP')
  await userEvent.click(button)
  expect(onClick).toHaveBeenCalled()
})

test('shows the photo when there is one', () => {
  render(<AvatarButton speaker={{ name: 'Anna Petrova', color: 1, photo: 'p.jpg' }} label="Change photo" />)
  expect(screen.getByRole('button', { name: 'Change photo' }).querySelector('img')?.getAttribute('src')).toBe('p.jpg')
})

test('the pencil comes on hover and keyboard focus only', () => {
  expect(css).toMatch(/\.overlay \{[^}]*opacity: 0/)
  expect(css).toMatch(/:hover \.overlay,\s*\.avatarButton:focus-visible \.overlay \{\s*opacity: 1/)
})

test('the letters make way for the pencil', () => {
  expect(css).toMatch(/:hover \[data-initials\],\s*\.avatarButton:focus-visible \[data-initials\] \{\s*visibility: hidden/)
})
