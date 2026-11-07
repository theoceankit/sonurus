import type { Meta, StoryObj } from '@storybook/react-vite'
import { EditorScreen } from '../Editor/EditorScreen'
import { EmptyState } from './EmptyState'
import styles from './EmptyState.stories.module.css'

const meta: Meta<typeof EmptyState> = {
  title: 'Screens/Home/Empty state',
  component: EmptyState,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof EmptyState>

// In the window, where the plus is, with no recordings at all.
export const InTheWindow: Story = {
  render: () => <div className={styles.window}><EditorScreen /></div>,
  parameters: { api: { scenario: 'empty' } },
}

export const Minimum: Story = {
  render: () => <div className={styles.minimum}><EditorScreen /></div>,
  parameters: { api: { scenario: 'empty' } },
}
