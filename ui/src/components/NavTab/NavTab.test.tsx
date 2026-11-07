import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Tabs } from '../Tabs/Tabs'
import { NavTab } from './NavTab'

test('a tab named by its text, the icon left out', () => {
  render(<Tabs orientation="vertical" aria-label="Settings" defaultValue="models" tabs={<NavTab value="models" icon="models">Models</NavTab>} />)
  const tab = screen.getByRole('tab', { name: 'Models' })
  expect(tab.getAttribute('aria-selected')).toBe('true')
  expect(tab.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
})
