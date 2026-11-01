import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { IconButton } from '../IconButton/IconButton'
import { SectionHeader } from './SectionHeader'

test('shows the title alone', () => {
  const { container } = render(<SectionHeader title="Speakers" />)
  expect(container.firstElementChild?.childElementCount).toBe(1)
  expect(screen.getByText('Speakers')).toBeTruthy()
})

test('shows a meta text, also 0', () => {
  render(<SectionHeader title="Speakers" meta="0" />)
  expect(screen.getByText('0')).toBeTruthy()
})

test('shows an action', () => {
  render(<SectionHeader title="Speakers" action={<IconButton icon="search" label="Search speakers" />} />)
  expect(screen.getByRole('button', { name: 'Search speakers' })).toBeTruthy()
})

test('meta and action together are a type error', () => {
  // @ts-expect-error the trailing slot holds one of them
  const wrong = () => <SectionHeader title="A" meta="1" action={null} />
  expect(wrong).toBeTypeOf('function')
})
