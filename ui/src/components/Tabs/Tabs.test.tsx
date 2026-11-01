import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { Tab } from '../Tab/Tab'
import { TabPanel, Tabs } from './Tabs'

const sections = (
  <Tabs
    aria-label="Sections"
    defaultValue="speakers"
    tabs={
      <>
        <Tab value="speakers">Speakers</Tab>
        <Tab value="chapters" disabled>Chapters</Tab>
        <Tab value="notes">Notes</Tab>
      </>
    }
  >
    <TabPanel value="speakers">Speakers panel</TabPanel>
    <TabPanel value="notes">Notes panel</TabPanel>
  </Tabs>
)

const tab = (name: string) => screen.getByRole('tab', { name })
const selected = () => screen.getByRole('tab', { selected: true })

test('the row is named and shows the panel of the selected tab', () => {
  render(sections)
  expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy()
  expect(screen.getByRole('tabpanel').textContent).toBe('Speakers panel')
})

test('Tab enters at the selected tab and leaves the row at once', async () => {
  render(<>{sections}<button>After</button></>)
  await userEvent.tab()
  expect(document.activeElement).toBe(tab('Speakers'))
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByRole('tabpanel'))
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByText('After'))
})

test('arrow keys select the next tab, skip a disabled one and wrap around', async () => {
  render(sections)
  await userEvent.tab()
  await userEvent.keyboard('{ArrowRight}')
  expect(selected()).toBe(tab('Notes'))
  expect(document.activeElement).toBe(tab('Notes'))
  expect(screen.getByRole('tabpanel').textContent).toBe('Notes panel')

  await userEvent.keyboard('{ArrowRight}')
  expect(selected()).toBe(tab('Speakers'))

  await userEvent.keyboard('{ArrowLeft}')
  expect(selected()).toBe(tab('Notes'))
})

test('a click selects', async () => {
  render(sections)
  await userEvent.click(tab('Notes'))
  expect(selected()).toBe(tab('Notes'))
})
