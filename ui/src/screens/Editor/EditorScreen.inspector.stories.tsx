import type { Meta, StoryObj } from '@storybook/react-vite'
import { ALL_HANDS_ID } from '../../api/fixtures/all-hands'
import { DESIGN_REVIEW_ID, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
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

// A speaker as if under the pointer: their turns in the transcript and their bars in
// the player. Lena is behind Show 3 more, so that lights up instead of her row.
export const SpeakerHighlighted: Story = { args: { possibleMatches: false, initialHighlight: SPEAKER_IDS.mark } }
export const UnknownSpeakerHighlighted: Story = { args: { possibleMatches: false, initialHighlight: SPEAKER_IDS.unknown1 } }
export const HiddenSpeakerHighlighted: Story = { args: { possibleMatches: false, initialHighlight: SPEAKER_IDS.lena } }

// Fifteen speakers in a window to resize by its corner: the rows follow the room.
export const FifteenSpeakers: Story = {
  args: { initialSelectedId: ALL_HANDS_ID, possibleMatches: false },
  parameters: { api: { board: 'speakerCounts' } },
  decorators: [Story => <div className={styles.resizable}><Story /></div>],
}
