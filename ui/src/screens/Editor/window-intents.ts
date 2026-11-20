import type { QueueSnapshot, TranscriptListItem } from '../../api/types'
import type { WindowIntent } from '../../platform/electron-api'
import { alignmentRetryJobs } from '../Queue/alignment'

// What a click on a notification of a transcription asks for, now: 'open' it, 'gone'
// (deleted or retried since: only the window comes up), or 'wait' for the list of
// recordings or the queue. A recording only just made may be missing from a list that
// is being loaded again, so that waits too.
export type IntentTarget = 'open' | 'gone' | 'wait'

type Known = {
  transcripts: readonly TranscriptListItem[] | undefined
  transcriptsFetching: boolean
  queue: QueueSnapshot | undefined
}

export function intentTarget(intent: WindowIntent, { transcripts, transcriptsFetching, queue }: Known): IntentTarget {
  if (!('open' in intent)) return 'open'
  if (intent.open === 'recording') {
    if (transcripts?.some(item => item.id === intent.transcriptId)) return 'open'
    return !transcripts || transcriptsFetching ? 'wait' : 'gone'
  }
  if (!queue) return 'wait'
  if (intent.open === 'job') return queue.jobs.some(job => job.id === intent.jobId) ? 'open' : 'gone'
  return alignmentRetryJobs(intent.language, queue).length > 0 ? 'open' : 'gone'
}
