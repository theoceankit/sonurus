import type { QueueJob, QueueSnapshot } from '../../api/types'

// offer: Download or Dismiss. downloading: its progress and Cancel. ready: the model is
// there, and one button retries what failed for it. failed: the last download of it
// here did not finish.
export type AlignmentState = 'offer' | 'downloading' | 'ready' | 'failed'

export const ALIGNMENT_MISSING = 'alignment_model_missing'

export function alignmentState({ downloading, installed, failed }: { downloading: boolean; installed: boolean; failed: boolean }): AlignmentState {
  if (downloading) return 'downloading'
  if (installed) return 'ready'
  return failed ? 'failed' : 'offer'
}

// Failed jobs waiting for this language's alignment model, in queue order.
export function alignmentRetryJobs(language: string, snapshot: QueueSnapshot | undefined): QueueJob[] {
  return (snapshot?.jobs ?? []).filter(job => job.status === 'failed' && job.error_code === ALIGNMENT_MISSING && job.error_language === language)
}

export const retryLabel = (count: number) => (count === 1 ? 'Retry transcription' : `Retry ${count} transcriptions`)

// The languages waiting for their dialog, the one shown first. Several queued jobs
// often fail on one model: a language already waiting is not added again.
export function addLanguage(waiting: readonly string[], language: string): string[] {
  return waiting.includes(language) ? [...waiting] : [...waiting, language]
}
