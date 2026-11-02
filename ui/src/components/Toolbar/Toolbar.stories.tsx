import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Toolbar, ToolbarDivider, ToolbarItem } from './Toolbar'

const meta: Meta<typeof Toolbar> = { component: Toolbar, args: { label: 'Actions' } }
export default meta

type Story = StoryObj<typeof Toolbar>

// The bar over a hovered paragraph. Tab enters it once, arrows move inside.
export const Actions: Story = {
  render: () => (
    <Toolbar label="Paragraph">
      <ToolbarItem><IconButton icon="play" label="Play" /></ToolbarItem>
      <ToolbarItem><IconButton icon="edit" label="Edit" /></ToolbarItem>
      <ToolbarItem><IconButton icon="copy" label="Copy" /></ToolbarItem>
      <ToolbarItem><IconButton icon="more" label="More" /></ToolbarItem>
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
