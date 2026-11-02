import type { Meta, StoryObj } from '@storybook/react-vite'
import { SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'
import { standing, waitFor } from './story-helpers'

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

export const Review: Story = { name: 'Review' }

export const PossibleMatch: Story = {
  name: 'Review / Possible match',
  args: { initialSpeakerId: SPEAKER_IDS.oliver },
}

export const ReviewClosed: Story = {
  name: 'Review closed',
  play: async () => { (await byLabel('Close review')).click() },
}

export const Done: Story = {
  name: 'Done',
  args: { possibleMatches: false },
  parameters: { api: { board: 'reviewDone' } },
}

export const ChooseSpeaker: Story = {
  name: 'Choose speaker',
  play: async () => { (await byLabel('Search speakers')).click() },
}

export const ChooseSpeakerNoResults: Story = {
  name: 'Choose speaker / No results',
  play: async () => {
    (await byLabel('Search speakers')).click()
    const field = await waitFor(() => document.querySelector('[role="dialog"] input')) as HTMLInputElement
    field.focus()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setValue.call(field, 'Zoe')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  },
}

export const NewSpeaker: Story = {
  name: 'New speaker',
  play: async () => { (await byText('Add a new speaker')).click() },
}

export const NewSpeakerOptionalDetails: Story = {
  name: 'New speaker / Optional details',
  play: async () => {
    (await byText('Add a new speaker')).click()
    ;(await byText('Optional details')).click()
  },
}
