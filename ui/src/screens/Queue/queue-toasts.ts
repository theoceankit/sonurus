import type { QueueUpdate } from '../../api/types'
import type { ToastOptions } from '../../components/Toast/toast-store'
import { ALIGNMENT_MISSING } from './alignment'

// What the user hears about a job that ended. A job that failed on a missing
// alignment model has the Alignment model dialog instead.
export function queueEventToast(event: QueueUpdate, openRecording: (transcriptId: number) => void): ToastOptions | null {
  if (event.type === 'job_done') {
    return { message: `"${event.title}" is ready`, action: { label: 'Open', onClick: () => openRecording(event.transcript_id) } }
  }
  if (event.type === 'job_failed' && event.error_code !== ALIGNMENT_MISSING) {
    return { message: `Transcription failed: "${event.title}"`, type: 'error' }
  }
  return null
}
