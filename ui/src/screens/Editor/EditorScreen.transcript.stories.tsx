import type { Meta, StoryObj } from '@storybook/react-vite'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { longSegments } from '../../api/fixtures/long-recording'
import { effectiveSpeaker } from '../../api/types'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'
import { paragraph, standing, waitFor } from './story-helpers'

// Not boards; those are in EditorBoards.transcript.stories.tsx.
const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor/Transcript',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID, playback: standing() },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

export const Playing: Story = {}

export const HoverActions: Story = {
  play: async ({ canvasElement }) => {
    const text = await paragraph(canvasElement, 'Retry for failed jobs')
    text.parentElement!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  },
}

export const StickyHeader: Story = {
  play: async ({ canvasElement }) => {
    const scroll = await waitFor(() => canvasElement.querySelector('[data-transcript-scroll]'))
    scroll.scrollTop = 200
  },
}

export const Paused: Story = { args: { playback: standing({ currentTime: 0, paused: true }) } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
// With recordings one is always open, so only an empty list leaves none.
export const NoRecording: Story = { parameters: { api: { scenario: 'empty' } } }

// Three hours, about 3600 segments, to scroll through. No sound here, the app has it.
export const LongRecording: Story = {
  args: { initialSelectedId: 1000, pinnedIds: undefined, playback: undefined },
  parameters: { api: { board: 'longRecording', noAudio: true } },
}

// The same with a speaker highlighted, for a look at many marked turns.
export const LongRecordingHighlighted: Story = {
  ...LongRecording,
  args: { ...LongRecording.args, initialHighlight: effectiveSpeaker(longSegments()[0]) },
}
