import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import css from './MentionChip.module.css?raw'
import unknownSpeakerSvg from '../../assets/icons/speaker-unknown.svg?raw'
import { MentionChip } from './MentionChip'

// Two wide letters, such as WM, are 17.5 px across: an avatar cut down to 16 clips them.
test("a speaker's two letters have the circle of the small avatar", () => {
  const { container } = render(<MentionChip target={{ kind: 'speaker', name: 'Walter Moore', color: 2 }} />)
  const initials = container.querySelector('[data-initials]')!
  expect(initials.textContent).toBe('WM')
  expect(initials.parentElement!.className).toMatch(/small/)
  expect(css).not.toMatch(/--size-avatar-/)
})

const pathsOf = (svg: Element | null) => [...(svg?.querySelectorAll('path') ?? [])].map(path => path.getAttribute('d'))

test('a voice with no name has the question mark of Unnamed where the avatar goes, and its label', () => {
  const { container } = render(<MentionChip target={{ kind: 'unnamed', name: 'Unknown speaker 1' }} />)
  expect(container.textContent!.trim()).toBe('Unknown speaker 1')
  expect(container.querySelector('[data-initials]')).toBeNull()
  const file = new DOMParser().parseFromString(unknownSpeakerSvg, 'image/svg+xml').querySelector('svg')
  expect(pathsOf(container.querySelector('svg'))).toEqual(pathsOf(file))
})
