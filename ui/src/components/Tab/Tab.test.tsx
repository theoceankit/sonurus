import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Tabs } from '../Tabs/Tabs'
import { Tab } from './Tab'

const inTabs = (tab: React.ReactNode, value = 'a') => <Tabs aria-label="Sections" value={value} tabs={tab} />

test('shows its label, and a count only when given one, also 0', () => {
  const { rerender } = render(inTabs(<Tab value="a">Speakers</Tab>))
  expect(screen.getByRole('tab', { name: 'Speakers' })).toBeTruthy()

  rerender(inTabs(<Tab value="a" count={0}>Speakers</Tab>))
  expect(screen.getByRole('tab').textContent).toBe('Speakers0')
})

test('says whether it is selected', () => {
  render(inTabs(<><Tab value="a">One</Tab><Tab value="b">Two</Tab></>))
  expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('false')
})

test('a disabled tab cannot be chosen', async () => {
  const onValueChange = vi.fn()
  render(<Tabs aria-label="Sections" value="a" onValueChange={onValueChange} tabs={<><Tab value="a">One</Tab><Tab value="b" disabled>Two</Tab></>} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Two' }))
  expect(onValueChange).not.toHaveBeenCalled()
})
