import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { SectionCard } from './SectionCard'

test('a region named by its title, with its rows and footer', () => {
  render(<SectionCard title="Alignment models" description="Word timings." footer="Not needed for English."><div>row</div></SectionCard>)
  const region = screen.getByRole('region', { name: 'Alignment models' })
  expect(region.textContent).toContain('Word timings.')
  expect(region.textContent).toContain('row')
  expect(region.textContent).toContain('Not needed for English.')
})

test('no heading without a title', () => {
  render(<SectionCard><div>row</div></SectionCard>)
  expect(screen.queryByRole('heading')).toBeNull()
})
