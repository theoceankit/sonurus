import type { Meta, StoryObj } from '@storybook/react-vite'
import { Titlebar } from './Titlebar'
import styles from './Titlebar.stories.module.css'

const meta: Meta<typeof Titlebar> = {
  component: Titlebar,
  decorators: [Story => <div className={styles.window}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Titlebar>

export const Default: Story = {}
export const SidebarClosed: Story = { args: { sidebarOpen: false } }
export const InspectorClosed: Story = { args: { inspectorOpen: false } }

// The window buttons are the system's, so here their place is only reserved.
export const WindowButtonsLeft: Story = { decorators: [Story => <div className={styles.buttonsLeft}><Story /></div>] }
export const WindowButtonsRight: Story = { decorators: [Story => <div className={styles.buttonsRight}><Story /></div>] }

export const Narrow: Story = { decorators: [Story => <div className={styles.narrow}><Story /></div>] }
export const NarrowWindowButtonsRight: Story = {
  decorators: [Story => <div className={`${styles.narrow} ${styles.buttonsRight}`}><Story /></div>],
}
