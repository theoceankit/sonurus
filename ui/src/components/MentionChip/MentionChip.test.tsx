import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import css from './MentionChip.module.css?raw'
import { MentionChip } from './MentionChip'

// Two wide letters, such as WM, are 17.5 px across: an avatar cut down to 16 clips them.
test("a speaker's two letters have the circle of the small avatar", () => {
  const { container } = render(<MentionChip target={{ kind: 'speaker', name: 'Walter Moore', color: 2 }} />)
  const initials = container.querySelector('[data-initials]')!
  expect(initials.textContent).toBe('WM')
  expect(initials.parentElement!.className).toMatch(/small/)
  expect(css).not.toMatch(/--size-avatar-/)
})
