import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { queueSnapshot, SPEAKER_IDS, SPEAKERS } from '../../api/fixtures/data'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import portrait2 from '../../api/fixtures/photos/portrait-2.jpg'
import { createPlayback } from '../../media/playback'
import { waitFor } from '../Editor/story-helpers'
import { DeleteSpeakerDialog } from './DeleteSpeakerDialog'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { SpeakersDialog, type SpeakersDialogProps } from './SpeakersDialog'

const noop = () => {}

// Anna and Lena have photos.
const PHOTOS: Record<string, string> = { [SPEAKER_IDS.anna]: portrait2, [SPEAKER_IDS.lena]: portrait }
const withPhotos = { api: { overrides: { listSpeakers: () => Promise.resolve(SPEAKERS.map(speaker => (PHOTOS[speaker.id] ? { ...speaker, photo: `${speaker.id}.jpg`, photo_url: PHOTOS[speaker.id] } : speaker))) } } }

const meta: Meta<typeof SpeakersDialog> = {
  title: 'Screens/Speakers',
  component: SpeakersDialog,
  args: { open: true, preview: true } satisfies Partial<SpeakersDialogProps>,
  render: function Render(args) {
    const [playback] = useState(() => createPlayback())
    return <SpeakersDialog {...args} playback={playback} onClose={noop} onOpenRecording={noop} />
  },
}
export default meta

type Story = StoryObj<typeof SpeakersDialog>

// The list.
export const AllSpeakers: Story = {}
export const Recognized: Story = { args: { initialCategory: 'named' } }
export const Unnamed: Story = { args: { initialCategory: 'unnamed' } }
export const Search: Story = { args: { initialQuery: 'ma' } }
export const NoMatch: Story = { args: { initialQuery: 'Zoe' } }
export const SameNames: Story = { parameters: { api: { board: 'sameNames' } } }
export const NoSpeakers: Story = { parameters: { api: { scenario: 'empty' } } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
export const WithPhotos: Story = { parameters: withPhotos }

// A speaker's card. Play, Appears in and the name field work on the fixtures.
export const Speaker: Story = { args: { initialSpeakerId: SPEAKER_IDS.lena } }
export const SpeakerWithPhoto: Story = { args: { initialSpeakerId: SPEAKER_IDS.lena }, parameters: withPhotos }
export const SpeakerWithoutName: Story = { args: { initialSpeakerId: SPEAKER_IDS.unknown2 } }
export const SpeakerWithSameName: Story = { args: { initialSpeakerId: SPEAKER_IDS.mark2 }, parameters: { api: { board: 'sameNames' } } }
// Archived partner call has lost its file: its Play is off.
export const RecordingWithoutAudio: Story = { args: { initialSpeakerId: SPEAKER_IDS.oliver } }
// The voice sample with its text open, as Show text leaves it.
export const SpeakerSampleText: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  play: async () => { (await waitFor(() => document.querySelector('[aria-label="Show text"]'))).click() },
}
// The sample is on its way: the player is off and has no text yet.
export const SpeakerSampleLoading: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  parameters: { api: { overrides: { getSpeakerSample: () => new Promise(() => {}) } } },
}
export const AudioUnavailable: Story = { args: { initialSpeakerId: SPEAKER_IDS.lena }, parameters: { api: { noAudio: true } } }
export const NotInAnyRecording: Story = { args: { initialSpeakerId: SPEAKER_IDS.priya } }
// An edited name waits for Save; Cancel takes it back.
export const SpeakerEdited: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  play: async () => {
    const name = await waitFor(() => document.querySelector('input[aria-label="Name"], input[placeholder="Add a name"]')) as HTMLInputElement
    // React tracks the value it set: go round its setter so the change is seen.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Lena K')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  },
}
// The Avatar window over the card: photo and colour.
export const SpeakerAvatarWindow: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  parameters: withPhotos,
  play: async () => { (await waitFor(() => document.querySelector('[aria-label="Change avatar"]'))).click() },
}
// More holds Merge and Delete. Radix opens a menu on pointer down, not on click.
const openMore = async () => {
  const more = await waitFor(() => document.querySelector('[aria-label="More"]'))
  more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
  return waitFor(() => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent?.trim() === 'Delete speaker'))
}
export const SpeakerMenu: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  play: async () => { await openMore() },
}
// Delete while the queue transcribes says why instead of asking.
export const DeleteBlocked: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  parameters: { api: { overrides: { getQueue: () => Promise.resolve(queueSnapshot({ running_job_id: 'job' })) } } },
  play: async () => { (await openMore()).click() },
}
export const DeleteRefused: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  parameters: { api: { overrides: { deleteSpeaker: () => Promise.reject(new Error('A recording is in progress')) } } },
}

export const DeleteConfirm: Story = {
  render: () => <DeleteSpeakerDialog preview open speaker={SPEAKERS.find(s => s.id === SPEAKER_IDS.lena)!} onConfirm={noop} onClose={noop} />,
}
export const DeleteConfirmWithoutName: Story = {
  render: () => <DeleteSpeakerDialog preview open speaker={{ ...SPEAKERS.find(s => s.id === SPEAKER_IDS.unknown3)!, segments: 0, transcripts: 0 }} onConfirm={noop} onClose={noop} />,
}
export const DiscardChanges: Story = {
  render: () => <DiscardChangesDialog preview open onDiscard={noop} onClose={noop} />,
}
