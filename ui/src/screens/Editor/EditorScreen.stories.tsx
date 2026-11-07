import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { useApi } from '../../api/ApiProvider'
import { QUEUE_JOB, queueSnapshot, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EVENT_SCRIPTS, type EventScript } from '../../api/fixtures/event-scripts'
import type { FixtureClient } from '../../api/fixtures/fixture-client'
import type { QueueJob } from '../../api/types'
import { App } from '../../App'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'

const size = (name: 'board' | 'minimum' | 'boundary'): Story['decorators'] => [Story => <div className={styles[name]}><Story /></div>]

const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: size('board'),
}
export default meta

type Story = StoryObj<typeof EditorScreen>

// Layout and sidebar as on the boards: the size, the pinned section, the selection.
export const Board: Story = { args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID } }
export const Default: Story = {}
export const Minimum: Story = { decorators: size('minimum') }
export const AtTheBoundary: Story = { decorators: size('boundary') }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Empty: Story = { parameters: { api: { scenario: 'empty' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
export const NoAudio: Story = { args: { initialSelectedId: WEEKLY_SYNC_ID }, parameters: { api: { noAudio: true } } }

// The whole app: what is on the screen stays, with a toast until the backend is back.
function WithBackendLost() {
  const api = useApi() as FixtureClient
  useEffect(() => {
    const lose = setTimeout(() => api.setConnected(false), 0)
    return () => clearTimeout(lose)
  }, [api])
  return <App />
}
export const BackendLost: Story = { render: () => <WithBackendLost /> }

// ── The transcription queue ────────────────────────────────────────────────────
// The whole app, with the fixtures' queue playing a script once the story opens.

function WithEvents({ script }: { script: EventScript }) {
  const api = useApi() as FixtureClient
  useEffect(() => api.playEvents(script), [api, script])
  return <App />
}

const job = (id: string, title: string, changes: Partial<QueueJob> = {}): QueueJob => ({
  ...QUEUE_JOB, id, title, audio_path: `/data/recordings/sonorus-import-${id}.mp3`, ...changes,
})

// One of each: running with its step, waiting, a live recording, a failed import and a
// job stopped by a missing alignment model. Every button works on the fixtures.
const QUEUE_NOW = queueSnapshot({
  running_job_id: 'q1',
  step: 'Transcribing audio…',
  jobs: [
    job('q1', 'Weekly product sync', { status: 'running' }),
    job('q2', 'Design review'),
    job('q3', 'Call with Mark', { audio_path: '/data/recordings/sonorus-rec-q3.webm' }),
    job('q4', 'Interview with a title long enough to be cut at the end of the card'),
    job('q5', 'Old customer call', { status: 'failed', error: 'Failed to load audio: invalid data found when processing input\n  more lines of the log' }),
    job('q6', 'Portuguese podcast', {
      status: 'failed', language: 'pt', error: 'Alignment model for language "pt" is not installed.',
      error_code: 'alignment_model_missing', error_language: 'pt',
    }),
  ],
})
const QUEUE: EventScript = { steps: [{ afterMs: 0, event: QUEUE_NOW }] }
export const WithQueue: Story = { render: () => <WithEvents script={QUEUE} /> }

// The same queue, paused.
const PAUSED: EventScript = {
  steps: [{
    afterMs: 0,
    event: {
      ...QUEUE_NOW,
      paused: true,
      running_job_id: null,
      step: null,
      jobs: QUEUE_NOW.jobs.map(j => (j.status === 'running' ? { ...j, status: 'waiting' } : j)),
    },
  }],
}
export const WithQueuePaused: Story = { render: () => <WithEvents script={PAUSED} /> }

// A job goes through its steps and is done: the card goes, a toast offers Open.
export const QueueTranscribing: Story = { render: () => <WithEvents script={EVENT_SCRIPTS.transcribing} /> }

// A job fails on a file it cannot read: an error toast, the card stays with Retry.
const FAILED: EventScript = {
  steps: [
    ...EVENT_SCRIPTS.transcribing.steps.slice(0, 3),
    { afterMs: 1600, event: { type: 'job_failed', job_id: QUEUE_JOB.id, title: QUEUE_JOB.title, error: 'Failed to load audio: invalid data found when processing input', error_code: null, error_language: null } },
    { afterMs: 0, event: queueSnapshot({ jobs: [{ ...QUEUE_JOB, status: 'failed', error: 'Failed to load audio: invalid data found when processing input' }] }) },
  ],
}
export const QueueFailed: Story = { render: () => <WithEvents script={FAILED} /> }
