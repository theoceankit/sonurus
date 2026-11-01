import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { MetaItem } from './MetaItem'

test('shows an icon at 16 and the value', () => {
  const { container } = render(<MetaItem icon="calendar">4 Oct 2026, 02:33</MetaItem>)
  expect(screen.getByText('4 Oct 2026, 02:33')).toBeTruthy()
  expect(container.querySelector('svg')?.getAttribute('class')).toMatch(/size16/)
})
