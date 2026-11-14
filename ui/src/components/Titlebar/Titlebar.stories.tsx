import type { Meta, StoryObj } from '@storybook/react-vite'
import { RecordingPill } from '../RecordingPill/RecordingPill'
import { Titlebar } from './Titlebar'
import styles from './Titlebar.stories.module.css'

const frame = (...classes: string[]): Story['decorators'] => [Story => <div className={[styles.window, ...classes].join(' ')}><Story /></div>]

const meta: Meta<typeof Titlebar> = {
  component: Titlebar,
}
export default meta

type Story = StoryObj<typeof Titlebar>

export const Default: Story = { decorators: frame() }
// Back and Forward: off while there is nowhere to go, as at startup.
export const CanGoBack: Story = { args: { canGoBack: true }, decorators: frame() }
export const CanGoBackAndForward: Story = { args: { canGoBack: true, canGoForward: true }, decorators: frame() }
export const SidebarClosed: Story = { args: { sidebarOpen: false }, decorators: frame() }
// The pointer on a panel's button: the line of its icon moves the way the panel
// will go. Towards the frame while the sidebar is open, away from it while closed.
const hovered = (label: string) => ({ pseudo: { hover: [`button[aria-label="${label}"]`] } })
export const SidebarToggleHover: Story = { decorators: frame(), parameters: hovered('Toggle sidebar') }
export const SidebarClosedToggleHover: Story = { args: { sidebarOpen: false }, decorators: frame(), parameters: hovered('Toggle sidebar') }
export const ShowInspectorHover: Story = { args: { inspectorOpen: false }, decorators: frame(), parameters: hovered('Show inspector') }
export const InspectorClosed: Story = { args: { inspectorOpen: false }, decorators: frame() }

// The window buttons are the system's, so here their place is only reserved.
export const WindowButtonsLeft: Story = { decorators: frame(styles.buttonsLeft) }
export const WindowButtonsRight: Story = { decorators: frame(styles.buttonsRight) }

export const Narrow: Story = { decorators: frame(styles.narrow) }
export const NarrowWindowButtonsRight: Story = { decorators: frame(styles.narrow, styles.buttonsRight) }

// A recording in progress while the sidebar is hidden: its pill before the tools.
export const WithRecording: Story = {
  args: { sidebarOpen: false, status: <RecordingPill phase="live" elapsed="12:34" onStop={() => {}} /> },
  decorators: frame(),
}
