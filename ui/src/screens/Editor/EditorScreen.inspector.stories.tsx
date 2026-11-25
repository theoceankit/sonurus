import type { Meta, StoryObj } from '@storybook/react-vite'
import { ALL_HANDS_ID } from '../../api/fixtures/all-hands'
import { DESIGN_REVIEW_ID, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'
import { toast } from '../../components/Toast/toast-store'
import { paragraph, standing, waitFor } from './story-helpers'

const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor/Inspector',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

export const WholeReview: Story = { args: { initialSelectedId: DESIGN_REVIEW_ID } }
export const OnlyNoName: Story = {}
export const PossibleMatches: Story = { parameters: { api: { board: 'possibleMatches' } } }
export const NoAudio: Story = { args: { initialSelectedId: DESIGN_REVIEW_ID }, parameters: { api: { noAudio: true } } }
// With recordings one is always open, so only an empty list leaves none.
export const NoRecording: Story = { parameters: { api: { scenario: 'empty' } } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }

// A speaker as if under the pointer: their turns in the transcript and their bars in
// the player. Lena is behind Show 3 more, so that lights up instead of her row.
export const SpeakerHighlighted: Story = { args: { initialHighlight: SPEAKER_IDS.mark } }
export const UnknownSpeakerHighlighted: Story = { args: { initialHighlight: SPEAKER_IDS.unknown1 } }
export const HiddenSpeakerHighlighted: Story = { args: { initialHighlight: SPEAKER_IDS.lena } }

// Fifteen speakers in a window to resize by its corner: the rows follow the room.
export const FifteenSpeakers: Story = {
  args: { initialSelectedId: ALL_HANDS_ID },
  parameters: { api: { board: 'speakerCounts' } },
  decorators: [Story => <div className={styles.resizable}><Story /></div>],
}

const byLabel = (label: string) => waitFor(() => document.querySelector(`[aria-label="${label}"]`))
const byText = (text: string) => waitFor(() => [...document.querySelectorAll('button')].find(node => node.textContent?.includes(text)))

// The one row hovered that a story can hold without a pointer.
const hoverRetry = async (canvas: HTMLElement) => {
  const text = await paragraph(canvas, 'Retry for failed jobs')
  text.parentElement!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
}

const typeInto = (field: HTMLInputElement, value: string) => {
  field.focus()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const dialogField = () => waitFor(() => document.querySelector('[role="dialog"] input')) as Promise<HTMLInputElement>

// The review of Possible Matches, the player standing, in each of its steps.
const review = { args: { playback: standing() }, parameters: { api: { board: 'possibleMatches' } } } satisfies Story

export const Review: Story = {
  ...review,
  play: async ({ canvasElement }) => { await hoverRetry(canvasElement) },
}

export const PossibleMatchOpen: Story = {
  ...review,
  args: { ...review.args, initialSpeakerId: SPEAKER_IDS.oliver },
}

export const ReviewClosed: Story = {
  ...review,
  play: async ({ canvasElement }) => {
    (await byLabel('Close review')).click()
    await hoverRetry(canvasElement)
  },
}

export const Done: Story = {
  args: { playback: standing() },
  parameters: { api: { board: 'reviewDone' } },
  play: () => { toast({ message: 'Assigned to Mark Ellis', action: { label: 'Undo', onClick: () => {} }, duration: 60000 }) },
}

export const ChooseSpeaker: Story = {
  ...review,
  play: async () => { (await byText('More speakers')).click() },
}

export const ChooseSpeakerNoResults: Story = {
  ...review,
  play: async () => {
    (await byText('More speakers')).click()
    typeInto(await dialogField(), 'Zoe')
  },
}

export const NewSpeaker: Story = {
  ...review,
  play: async () => {
    (await byText('More speakers')).click()
    ;(await byText('New speaker')).click()
    typeInto(await waitFor(() => document.querySelector('[role="dialog"] input[placeholder="Speaker name"]')) as HTMLInputElement, 'Olivia Brown')
  },
}
