import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../components/Button/Button'
import { IconButton } from '../components/IconButton/IconButton'
import { Inline } from '../components/Inline/Inline'
import { Menu, MenuAction } from '../components/Menu/Menu'
import { Stack } from '../components/Stack/Stack'
import { Tab } from '../components/Tab/Tab'
import { TabPanel, Tabs } from '../components/Tabs/Tabs'
import { notImplementedProps } from '../not-implemented'

const meta: Meta = { title: 'Foundations/Not implemented' }
export default meta

type Story = StoryObj

// Every marked control is dimmed, has the help cursor and only shows the toast.
export const Controls: Story = {
  render: () => (
    <Stack gap={6} padding={4}>
      <Inline gap={2}>
        <Button {...notImplementedProps('story.button')} icon="add">Marked</Button>
        <Button>Works</Button>
        <IconButton {...notImplementedProps('story.icon-button')} icon="copy" label="Marked" />
        <Button disabled>Disabled</Button>
      </Inline>
      <Tabs
        aria-label="Sections"
        defaultValue="speakers"
        tabs={
          <>
            <Tab value="speakers">Speakers</Tab>
            <Tab value="chapters" {...notImplementedProps('story.tab')}>Chapters</Tab>
            <Tab value="notes">Notes</Tab>
          </>
        }
      >
        <TabPanel value="speakers">Speakers panel</TabPanel>
        <TabPanel value="chapters">Must never show</TabPanel>
        <TabPanel value="notes">Notes panel</TabPanel>
      </Tabs>
      <Menu trigger={<Button>Menu</Button>}>
        <MenuAction icon="copy">Works</MenuAction>
        <MenuAction {...notImplementedProps('story.menu-item')} icon="bookmark">Marked</MenuAction>
      </Menu>
      <div {...notImplementedProps('story.container')}>
        <Inline gap={2}>
          <Button>Inside a marked container</Button>
          <Button variant="primary">And this one</Button>
        </Inline>
      </div>
    </Stack>
  ),
}
