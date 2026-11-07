import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueueJobView } from './QueueJobView'
import styles from './QueueJobView.stories.module.css'

// The centre for a job picked in the queue. In the app: Screens/Editor, With queue,
// then a click on a row.
const meta: Meta<typeof QueueJobView> = {
  title: 'Screens/Queue/Job view',
  component: QueueJobView,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.frame}><Story /></div>],
}
export default meta
type Story = StoryObj<typeof QueueJobView>

const ERROR = `Failed to load audio: invalid data found when processing input
  [mp3 @ 0x5581] Format mp3 detected only with low score of 1, misdetection possible!
  [mp3 @ 0x5581] Failed to find two consecutive MPEG audio frames.
  /data/recordings/sonorus-import-4.mp3: Invalid data found when processing input`

export const Failed: Story = { args: { title: 'Old customer call', status: 'failed', statusText: 'Transcription failed', error: ERROR } }
export const ModelMissing: Story = {
  args: {
    title: 'Portuguese podcast',
    status: 'failed',
    statusText: 'Alignment model for "Portuguese" is not installed',
    error: 'Alignment model for language "pt" is not installed. Download it in Settings.',
  },
}
export const LogOpen: Story = { args: { ...Failed.args, initialLogOpen: true } }
export const LongLogOpen: Story = { args: { ...Failed.args, initialLogOpen: true, error: Array.from({ length: 60 }, (_, i) => `line ${i + 1}: ${ERROR.split('\n')[1]}`).join('\n') } }
export const Retrying: Story = { args: { ...Failed.args, retrying: true } }
export const Waiting: Story = { args: { title: 'Design review', status: 'waiting', statusText: 'Waiting in the queue' } }
export const WaitingPaused: Story = { args: { title: 'Design review', status: 'waiting', statusText: 'Waiting, queue paused' } }
// The status glints now and then, as the row's title does.
export const Running: Story = { args: { title: 'Weekly product sync', status: 'running', statusText: 'Transcribing audio…' } }
