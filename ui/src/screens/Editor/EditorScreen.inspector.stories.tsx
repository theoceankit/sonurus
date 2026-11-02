import type { Meta, StoryObj } from '@storybook/react-vite'
import { DESIGN_REVIEW_ID, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'

// Not boards; those are in EditorBoards.speakers.stories.tsx.
const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor/Inspector',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID, possibleMatches: true },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

export const WholeReview: Story = { args: { initialSelectedId: DESIGN_REVIEW_ID, possibleMatches: false } }
export const InTheApp: Story = { args: { possibleMatches: false } }
export const NoAudio: Story = { args: { initialSelectedId: DESIGN_REVIEW_ID, possibleMatches: false }, parameters: { api: { noAudio: true } } }
export const NoRecording: Story = { args: { initialSelectedId: null } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
