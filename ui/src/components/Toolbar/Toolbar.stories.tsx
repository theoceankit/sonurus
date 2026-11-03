import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button/Button'
import { Toolbar, ToolbarAction, ToolbarDivider, ToolbarItem } from './Toolbar'

const meta: Meta<typeof Toolbar> = { component: Toolbar, args: { label: 'Actions' } }
export default meta

type Story = StoryObj<typeof Toolbar>

// The bar over a hovered paragraph. Tab enters it once, arrows move inside.
export const Actions: Story = {
  render: () => (
    <Toolbar label="Paragraph">
      <ToolbarAction icon="play" label="Play" />
      <ToolbarAction icon="edit" label="Edit" />
      <ToolbarAction icon="copy" label="Copy" />
      <ToolbarAction icon="more" label="More" />
    </Toolbar>
  ),
}

// The bar over selected text.
export const Labels: Story = {
  render: () => (
    <Toolbar label="Selection">
      <ToolbarItem><Button variant="toolbar" icon="copy">Copy</Button></ToolbarItem>
      <ToolbarDivider />
      <ToolbarItem><Button variant="toolbar" icon="highlight">Highlight</Button></ToolbarItem>
    </Toolbar>
  ),
}
