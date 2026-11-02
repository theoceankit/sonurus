import type { Meta, StoryObj } from '@storybook/react-vite'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorPlayer, useTranscriptPlayback } from './EditorPlayer'
import styles from './EditorPlayer.stories.module.css'

function Wired({ transcriptId }: { transcriptId: number | null }) {
  return <EditorPlayer transcriptId={transcriptId} playback={useTranscriptPlayback(transcriptId)} />
}

const meta: Meta<typeof Wired> = {
  title: 'Screens/Editor/Player',
  component: Wired,
  args: { transcriptId: WEEKLY_SYNC_ID },
  decorators: [Story => <div className={styles.panel}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Wired>

// Real sound: every speaker has a tone of their own and pauses are silent.
export const OnTestAudio: Story = {}

export const NoAudio: Story = { parameters: { api: { noAudio: true } } }

export const NoRecordingOpen: Story = { args: { transcriptId: null } }
