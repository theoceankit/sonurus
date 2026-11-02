import type { Meta, StoryObj } from '@storybook/react-vite'
import { Titlebar } from './Titlebar'
import styles from './Titlebar.stories.module.css'

const frame = (...classes: string[]): Story['decorators'] => [Story => <div className={[styles.window, ...classes].join(' ')}><Story /></div>]

const meta: Meta<typeof Titlebar> = {
  component: Titlebar,
}
export default meta

type Story = StoryObj<typeof Titlebar>

export const Default: Story = { decorators: frame() }
export const SidebarClosed: Story = { args: { sidebarOpen: false }, decorators: frame() }
export const InspectorClosed: Story = { args: { inspectorOpen: false }, decorators: frame() }

// The window buttons are the system's, so here their place is only reserved.
export const WindowButtonsLeft: Story = { decorators: frame(styles.buttonsLeft) }
export const WindowButtonsRight: Story = { decorators: frame(styles.buttonsRight) }

export const Narrow: Story = { decorators: frame(styles.narrow) }
export const NarrowWindowButtonsRight: Story = { decorators: frame(styles.narrow, styles.buttonsRight) }
