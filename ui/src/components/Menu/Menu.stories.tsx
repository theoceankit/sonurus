import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Inline } from '../Inline/Inline'
import { Menu, MenuAction, MenuDivider, MenuOption, MenuOptions, MenuSection, MenuSurface } from './Menu'

const meta: Meta<typeof Menu> = {
  component: Menu,
  args: { trigger: <Button>Open</Button>, children: null },
}
export default meta

type Story = StoryObj<typeof Menu>

const items = (
  <>
    <MenuAction icon="edit">Rename</MenuAction>
    <MenuAction icon="copy" meta="Ctrl+C">Copy</MenuAction>
    <MenuAction icon="speakers" disabled>Merge speakers</MenuAction>
    <MenuDivider />
    <MenuAction icon="settings">Settings</MenuAction>
  </>
)

// Tab to Open, then Enter, arrows, Enter or Escape.
export const Plain: Story = {
  render: () => <Menu trigger={<Button>Open</Button>}>{items}</Menu>,
}

export const Opened: Story = {
  render: () => <Menu trigger={<Button>Open</Button>} open>{items}</Menu>,
}

const WithOptions = () => {
  const [model, setModel] = useState('large-v3')
  return (
    <Menu trigger={<Button>Model</Button>} open>
      <MenuSection title="Model">
        <MenuOptions value={model} onValueChange={setModel}>
          <MenuOption value="tiny">tiny</MenuOption>
          <MenuOption value="base">base</MenuOption>
          <MenuOption value="large-v3" meta="Default">large-v3</MenuOption>
        </MenuOptions>
      </MenuSection>
    </Menu>
  )
}

export const Sections: Story = { render: () => <WithOptions /> }

export const Current: Story = {
  render: () => (
    <Menu trigger={<Button>Filter</Button>} open>
      <MenuAction current>All speakers</MenuAction>
      <MenuAction>In this recording</MenuAction>
    </Menu>
  ),
}

export const AlignedToEnd: Story = {
  render: () => (
    <Inline justify="end" gap={2}>
      <Menu trigger={<IconButton icon="more" label="More" />} align="end" open>{items}</Menu>
    </Inline>
  ),
}

// A short list of short values, opening upwards, as the speed of the player.
export const NarrowAbove: Story = {
  render: () => (
    <Inline padding={8} paddingY={8}>
      <Menu side="top" align="end" size="narrow" defaultOpen trigger={<Button size="small">1×</Button>}>
        <MenuOptions value="1" onValueChange={() => {}}>
          <MenuOption value="0.5">0.5×</MenuOption>
          <MenuOption value="1">1×</MenuOption>
          <MenuOption value="2">2×</MenuOption>
        </MenuOptions>
      </Menu>
    </Inline>
  ),
}

export const Surface: Story = {
  render: () => <MenuSurface><span>Any content, such as a search field and a list</span></MenuSurface>,
}
