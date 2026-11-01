import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tab } from '../Tab/Tab'
import { TabPanel, Tabs } from './Tabs'

const meta: Meta<typeof Tabs> = {
  component: Tabs,
  args: {
    'aria-label': 'Sections',
    defaultValue: 'speakers',
    tabs: (
      <>
        <Tab value="speakers">Speakers</Tab>
        <Tab value="chapters">Chapters</Tab>
        <Tab value="notes">Notes</Tab>
      </>
    ),
  },
}
export default meta

type Story = StoryObj<typeof Tabs>

export const Default: Story = {}

export const WithCountsAndPanels: Story = {
  args: {
    tabs: (
      <>
        <Tab value="speakers" count={6}>Speakers</Tab>
        <Tab value="chapters" count={0}>Chapters</Tab>
        <Tab value="notes" disabled>Notes</Tab>
      </>
    ),
    children: (
      <>
        <TabPanel value="speakers">Speakers panel</TabPanel>
        <TabPanel value="chapters">Chapters panel</TabPanel>
      </>
    ),
  },
}
