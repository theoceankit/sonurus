import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { queueSnapshot, SPEAKER_IDS, SPEAKERS } from '../../api/fixtures/data'
import { createPlayback } from '../../media/playback'
import { DeleteSpeakerDialog } from './DeleteSpeakerDialog'
import { SpeakersDialog, type SpeakersDialogProps } from './SpeakersDialog'

const noop = () => {}

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
export const Named: Story = { args: { initialCategory: 'named' } }
export const Unnamed: Story = { args: { initialCategory: 'unnamed' } }
export const Search: Story = { args: { initialQuery: 'ma' } }
export const NoMatch: Story = { args: { initialQuery: 'Zoe' } }
export const SameNames: Story = { parameters: { api: { board: 'sameNames' } } }
export const NoSpeakers: Story = { parameters: { api: { scenario: 'empty' } } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }

// A speaker's card. Play, Appears in and the name field work on the fixtures.
export const Speaker: Story = { args: { initialSpeakerId: SPEAKER_IDS.lena } }
export const SpeakerWithoutName: Story = { args: { initialSpeakerId: SPEAKER_IDS.unknown2 } }
export const SpeakerWithSameName: Story = { args: { initialSpeakerId: SPEAKER_IDS.mark2 }, parameters: { api: { board: 'sameNames' } } }
// Archived partner call has lost its file: its Play is off.
export const RecordingWithoutAudio: Story = { args: { initialSpeakerId: SPEAKER_IDS.oliver } }
export const AudioUnavailable: Story = { args: { initialSpeakerId: SPEAKER_IDS.lena }, parameters: { api: { noAudio: true } } }
export const NotInAnyRecording: Story = { args: { initialSpeakerId: SPEAKER_IDS.priya } }
export const DeleteBlocked: Story = {
  args: { initialSpeakerId: SPEAKER_IDS.lena },
  parameters: { api: { overrides: { getQueue: () => Promise.resolve(queueSnapshot({ running_job_id: 'job' })) } } },
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
