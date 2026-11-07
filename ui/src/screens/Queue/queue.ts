import type { QueueJob, QueueSnapshot } from '../../api/types'
import type { IconName } from '../../components/Icon/icon-names'
import { alignmentModel } from '../../transcribe/languages'

// ── Header ─────────────────────────────────────────────────────────────────────

export function queueStateLabel(snapshot: QueueSnapshot): string {
  if (!snapshot.paused) return 'Running'
  return snapshot.paused_by_recording ? 'Paused while recording' : 'Paused'
}

export type QueueToggle = { action: 'start' | 'pause'; label: string; icon: IconName }

// The first item of a row's menu. Resume is offered during a recording too: running
// both is the user's choice.
export function queueToggle(snapshot: QueueSnapshot): QueueToggle {
  return snapshot.paused
    ? { action: 'start', label: 'Resume queue', icon: 'play' }
    : { action: 'pause', label: 'Pause queue', icon: 'pause' }
}

// ── Job card ───────────────────────────────────────────────────────────────────

// The status of a job in the centre, once it is picked in the queue. The whole error
// of a failed job is shown under it.
export function jobStatusText(job: QueueJob, snapshot: QueueSnapshot): string {
  if (job.status === 'running') return snapshot.step || 'Starting…'
  if (job.status === 'failed') {
    if (job.error_code === 'alignment_model_missing') {
      // Named as the Alignment model dialog names it.
      return `Alignment model for "${alignmentModel(job.error_language ?? '').name}" is not installed`
    }
    if (job.error_code === 'whisper_model_missing') {
      // From the error: the job's model may have been edited since it failed.
      const failedOn = /Whisper model "([^"]+)"/.exec(job.error ?? '')?.[1]
      return failedOn ? `Whisper model "${failedOn}" is not installed` : 'Whisper model is not installed'
    }
    if (job.error_code === 'diarization_model_missing') return 'Diarization model is not installed'
    return 'Transcription failed'
  }
  return snapshot.paused ? 'Waiting, queue paused' : 'Waiting in the queue'
}

// An imported file is a copy the backend made (sonorus-import-*); anything else is a
// live recording, and deleting it is for good.
const isImport = (job: QueueJob) => /(^|[\\/])sonorus-import-[^\\/]*$/.test(job.audio_path)

export function deleteJobPrompt(job: QueueJob): { title: string; body: string } {
  return {
    title: `Delete "${job.title}"?`,
    body: isImport(job)
      ? "The job and the app's copy of the file will be deleted. Your original file is kept."
      : 'The recording will be deleted. This cannot be undone.',
  }
}

// ── Order ──────────────────────────────────────────────────────────────────────

export type DropPlace = 'before' | 'after'

// The order after dropping one job before or after another. Onto itself or an
// unknown id it stays as it was. The input is not changed.
export function reorderJobIds(ids: readonly string[], draggedId: string, targetId: string, place: DropPlace): string[] {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return [...ids]
  const rest = ids.filter(id => id !== draggedId)
  const at = rest.indexOf(targetId) + (place === 'after' ? 1 : 0)
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)]
}

// Where a dragged card lands next to the card under the pointer.
export function dropPlace(rect: { top: number; height: number }, clientY: number): DropPlace {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

// The order with one job a step up or down (Alt+Up and Alt+Down); null when it
// cannot move that way.
export function moveJob(ids: readonly string[], jobId: string, step: -1 | 1): string[] | null {
  const from = ids.indexOf(jobId)
  const to = from + step
  if (from < 0 || to < 0 || to >= ids.length) return null
  const next = [...ids]
  next[from] = ids[to]
  next[to] = jobId
  return next
}
