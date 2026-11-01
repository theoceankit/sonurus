import type { Transcript, TranscriptListItem, QueueUpdate } from '../types'
import { PLANNING_CALL, PLANNING_CALL_ID, PLANNING_CALL_ITEM, QUEUE_JOB, queueSnapshot } from './data'

export type EventStep = { afterMs: number; event: QueueUpdate }

export type EventScript = {
  steps: EventStep[]
  // Added to the list when job_done comes, as the pipeline would have saved it.
  result?: { item: TranscriptListItem; transcript: Transcript }
}

const running = (step: string) => queueSnapshot({
  running_job_id: QUEUE_JOB.id,
  step,
  jobs: [{ ...QUEUE_JOB, status: 'running' }],
})

const started: EventStep[] = [
  { afterMs: 0, event: queueSnapshot({ jobs: [QUEUE_JOB] }) },
  { afterMs: 800, event: running('Loading models…') },
  { afterMs: 1200, event: running('Transcribing audio…') },
]

export const EVENT_SCRIPTS = {
  // The queue takes a job and finishes it; the recording appears in the list.
  transcribing: {
    steps: [
      ...started,
      { afterMs: 1600, event: running('Saving to database…') },
      { afterMs: 800, event: { type: 'job_done', job_id: QUEUE_JOB.id, title: QUEUE_JOB.title, transcript_id: PLANNING_CALL_ID } },
      { afterMs: 0, event: queueSnapshot() },
    ],
    result: { item: PLANNING_CALL_ITEM, transcript: PLANNING_CALL },
  },
  // The job stops on a missing alignment model and stays in the queue as failed.
  failed: {
    steps: [
      ...started,
      {
        afterMs: 1600,
        event: {
          type: 'job_failed',
          job_id: QUEUE_JOB.id,
          title: QUEUE_JOB.title,
          error: 'Alignment model for language "pt" is not installed. Download it in Settings.',
          error_code: 'alignment_model_missing',
          error_language: 'pt',
        },
      },
      {
        afterMs: 0,
        event: queueSnapshot({
          jobs: [{
            ...QUEUE_JOB,
            status: 'failed',
            error: 'Alignment model for language "pt" is not installed. Download it in Settings.',
            error_code: 'alignment_model_missing',
            error_language: 'pt',
          }],
        }),
      },
    ],
  },
} satisfies Record<string, EventScript>
