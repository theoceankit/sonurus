import type { Meta, StoryObj } from '@storybook/react-vite'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'

const size = (name: 'board' | 'minimum' | 'boundary'): Story['decorators'] => [Story => <div className={styles[name]}><Story /></div>]

const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: size('board'),
}
export default meta

type Story = StoryObj<typeof EditorScreen>

// Layout and sidebar as on the boards: the size, the pinned section, the selection.
export const Board: Story = { args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID } }
export const Default: Story = {}
export const Minimum: Story = { decorators: size('minimum') }
export const AtTheBoundary: Story = { decorators: size('boundary') }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Empty: Story = { parameters: { api: { scenario: 'empty' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
