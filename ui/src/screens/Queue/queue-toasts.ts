import { useCallback, useEffect, useRef } from 'react'
import { useTranscripts } from '../../api/queries'
import type { QueueUpdate, TranscriptListItem } from '../../api/types'
import { toast, type ToastOptions } from '../../components/Toast/toast-store'
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

// A request about the queue that the backend refused: what it said, as an error.
export const refused = (error: Error) => toast({ message: error.message, type: 'error' })

const listed = (list: readonly TranscriptListItem[] | undefined, id: number) => !!list?.some(item => item.id === id)

// Shows the toasts of queue events. The toast of a finished job goes once its
// recording is no longer in the list, so Open never opens what was deleted.
export function useQueueToasts(openRecording: (transcriptId: number) => void) {
  const list = useTranscripts().data
  const latestList = useRef(list)
  latestList.current = list
  // The ready toasts still showing, by recording, and whether the list has had it:
  // a recording just made may not be in a list loaded before it.
  const ready = useRef(new Map<number, { close: () => void; seen: boolean }>())

  useEffect(() => {
    if (!list) return
    for (const [id, shown] of ready.current) {
      if (listed(list, id)) shown.seen = true
      else if (shown.seen) {
        shown.close()
        ready.current.delete(id)
      }
    }
  }, [list])

  return useCallback((event: QueueUpdate) => {
    const options = queueEventToast(event, id => {
      const shown = ready.current.get(id)
      ready.current.delete(id)
      // In the list, or too new for it yet; not one the list has had and lost.
      if (listed(latestList.current, id) || (shown && !shown.seen)) openRecording(id)
    })
    if (!options) return
    const close = toast(options)
    if (event.type === 'job_done') {
      ready.current.get(event.transcript_id)?.close()
      ready.current.set(event.transcript_id, { close, seen: listed(latestList.current, event.transcript_id) })
    }
  }, [openRecording])
}
