import type { Meta, StoryObj } from '@storybook/react-vite'
import { SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'
import { toast } from '../../components/Toast/toast-store'
import { paragraph, standing, waitFor } from './story-helpers'

// The boards of Redesign / Editor / Speakers, with the names of the boards.
const meta: Meta<typeof EditorScreen> = {
  title: 'Redesign/Editor/Speakers',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID, possibleMatches: true, playback: standing() },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

const byLabel = (label: string) => waitFor(() => document.querySelector(`[aria-label="${label}"]`))
const byText = (text: string) => waitFor(() => [...document.querySelectorAll('button')].find(node => node.textContent?.includes(text)))

// The one row the board shows hovered that a story can hold without a pointer.
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

export const Review: Story = {
  name: 'Review',
  play: async ({ canvasElement }) => { await hoverRetry(canvasElement) },
}

export const PossibleMatch: Story = {
  name: 'Review / Possible match',
  args: { initialSpeakerId: SPEAKER_IDS.oliver },
}

export const ReviewClosed: Story = {
  name: 'Review closed',
  play: async ({ canvasElement }) => {
    (await byLabel('Close review')).click()
    await hoverRetry(canvasElement)
  },
}

export const Done: Story = {
  name: 'Done',
  args: { possibleMatches: false },
  parameters: { api: { board: 'reviewDone' } },
  play: () => { toast({ message: 'Assigned to Mark Ellis', action: { label: 'Undo', onClick: () => {} }, duration: 60000 }) },
}

export const ChooseSpeaker: Story = {
  name: 'Choose speaker',
  play: async () => { (await byText('More speakers')).click() },
}

export const ChooseSpeakerNoResults: Story = {
  name: 'Choose speaker / No results',
  play: async () => {
    (await byText('More speakers')).click()
    typeInto(await dialogField(), 'Zoe')
  },
}

export const NewSpeaker: Story = {
  name: 'New speaker',
  play: async () => {
    (await byText('More speakers')).click()
    ;(await byText('New speaker')).click()
    typeInto(await waitFor(() => document.querySelector('[role="dialog"] input[placeholder="Speaker name"]')) as HTMLInputElement, 'Olivia Brown')
  },
}
