import type { ModelInfo, QueueJob, QueueSnapshot } from '../api/types'

// Deleting a model the queue needs. Every job needs the diarization model, a Whisper
// model only its own jobs, an alignment model the jobs in its language (not detected
// ones: their language is known only once they run).

function jobNeedsModel(job: QueueJob, model: ModelInfo): boolean {
  if (model.kind === 'diarization') return true
  if (model.kind === 'whisper') return job.whisper_model === model.id
  return model.kind === 'alignment' && job.language === model.id
}

// How many waiting or failed jobs need the model.
export function queuedJobsUsingModel(model: ModelInfo, queue: QueueSnapshot | undefined): number {
  if (!queue) return 0
  return queue.jobs.filter(job => (job.status === 'waiting' || job.status === 'failed') && jobNeedsModel(job, model)).length
}

// The running transcription needs the model: the backend refuses the delete.
export function modelInUseByRunningJob(model: ModelInfo, queue: QueueSnapshot | undefined): boolean {
  const running = queue?.jobs.find(job => job.id === queue.running_job_id)
  return !!running && jobNeedsModel(running, model)
}

export const IN_USE_BY_RUNNING = 'In use by the running transcription'

// The confirmation before deleting a model queued jobs need, or null when none do.
export function modelDeletePrompt(name: string, count: number): { title: string; body: string } | null {
  if (!count) return null
  const jobs = count === 1 ? '1 job in the queue uses' : `${count} jobs in the queue use`
  return { title: `Delete ${name}?`, body: `${jobs} ${name}. Delete anyway?` }
}
