import type { Meta, StoryObj } from '@storybook/react-vite'
import { DESIGN_REVIEW_ID, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'

const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor/Inspector',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID, possibleMatches: true },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

const waitFor = async (find: () => HTMLElement | null | undefined) => {
  for (let i = 0; i < 100; i++) {
    const found = find()
    if (found) return found
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Not found')
}

const byLabel = (label: string) => waitFor(() => document.querySelector<HTMLElement>(`[aria-label="${label}"]`))
const byText = (text: string) => waitFor(() => [...document.querySelectorAll('button')].find(node => node.textContent?.includes(text)))

// The boards, with the names of the boards.
export const Review: Story = {}
export const PossibleMatch: Story = { args: { initialSpeakerId: SPEAKER_IDS.oliver } }
export const Done: Story = { args: { possibleMatches: false }, parameters: { api: { board: 'reviewDone' } } }
export const ReviewClosed: Story = {
  play: async () => { (await byLabel('Close review')).click() },
}
export const ChooseSpeaker: Story = {
  play: async () => { (await byLabel('Search speakers')).click() },
}
export const ChooseSpeakerNoResults: Story = {
  play: async () => {
    (await byLabel('Search speakers')).click()
    const field = await waitFor(() => document.querySelector<HTMLInputElement>('[role="dialog"] input'))
    field.focus()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setValue.call(field, 'Zoe')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  },
}
export const NewSpeaker: Story = {
  play: async () => { (await byText('Add a new speaker')).click() },
}
export const NewSpeakerOptionalDetails: Story = {
  play: async () => {
    (await byText('Add a new speaker')).click()
    ;(await byText('Optional details')).click()
  },
}
export const Unassigned: Story = { args: { possibleMatches: false }, parameters: { api: { board: 'unassigned' } } }

// Not boards.
export const WholeReview: Story = { args: { initialSelectedId: DESIGN_REVIEW_ID, possibleMatches: false } }
export const InTheApp: Story = { args: { possibleMatches: false } }
export const NoAudio: Story = { args: { initialSelectedId: DESIGN_REVIEW_ID, possibleMatches: false }, parameters: { api: { noAudio: true } } }
export const NoRecording: Story = { args: { initialSelectedId: null } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
