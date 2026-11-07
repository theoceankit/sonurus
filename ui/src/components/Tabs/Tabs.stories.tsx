import type { Meta, StoryObj } from '@storybook/react-vite'
import { NavTab } from '../NavTab/NavTab'
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

export const Vertical: Story = {
  args: {
    orientation: 'vertical',
    'aria-label': 'Settings',
    defaultValue: 'general',
    style: { height: 280 },
    tabs: (
      <div style={{ width: 184 }}>
        <NavTab value="general" icon="settings">General</NavTab>
        <NavTab value="models" icon="models">Models</NavTab>
        <NavTab value="alignment" icon="alignment">Alignment</NavTab>
      </div>
    ),
    header: <span>Search</span>,
    footer: <span>Sonorus 0.3.0</span>,
    children: (
      <>
        <TabPanel value="general" style={{ paddingInline: 24 }}>General panel</TabPanel>
        <TabPanel value="models" style={{ paddingInline: 24 }}>Models panel</TabPanel>
        <TabPanel value="alignment" style={{ paddingInline: 24 }}>Alignment panel</TabPanel>
      </>
    ),
  },
}
