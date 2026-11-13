import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { useModels, useQueue } from '../../api/queries'
import type { QueueUpdate } from '../../api/types'
import { toast } from '../../components/Toast/toast-store'
import { useOpenModalCount } from '../../components/Modal/open-modals'
import { useModelDownloads } from '../../transcribe/model-downloads'
import { useSettingsDialog } from '../Settings/SettingsProvider'
import { addLanguage, ALIGNMENT_MISSING, alignmentRetryJobs, alignmentState } from './alignment'
import type { AlignmentDialogProps } from './AlignmentDialog'
import { downloadFailureLine } from '../../transcribe/download-errors'

type Waiting = {
  // The first is shown; the others wait for it to close.
  languages: string[]
  // The shown one is on its way out: it leaves the list once it has gone.
  closing: boolean
  // A download of the shown language was seen running: if it then ends without the
  // model, the download failed.
  watched: boolean
  // The first one is on the screen. It waits while another window is open, such as
  // New transcription, and once shown stays until it is closed.
  shown: boolean
}

// The Alignment model dialogs, one language at a time, in the order the jobs failed.
// Returns what the queue events go through and the props of the shown dialog.
export function useAlignmentDialogs() {
  const api = useApi()
  const downloads = useModelDownloads()
  const settingsDialog = useSettingsDialog()
  const models = useModels()
  const queue = useQueue()
  const [waiting, setWaiting] = useState<Waiting>({ languages: [], closing: false, watched: false, shown: false })
  const [cancelling, setCancelling] = useState(false)
  const language = waiting.languages[0] ?? null
  const download = language ? downloads.download(language) : null
  // Before it is shown, every open window is another one.
  const othersOpen = useOpenModalCount() > 0
  if (language && !waiting.shown && !waiting.closing && !othersOpen) setWaiting({ ...waiting, shown: true })

  const onQueueEvent = useCallback((event: QueueUpdate) => {
    if (event.type !== 'job_failed' || event.error_code !== ALIGNMENT_MISSING || !event.error_language) return
    const failed = event.error_language
    // A failure of the language on its way out opens it again after.
    setWaiting(current => ({
      ...current,
      languages: current.closing && current.languages[0] === failed
        ? [...current.languages, failed]
        : addLanguage(current.languages, failed),
    }))
  }, [])

  const { refetch: refetchModels } = models
  useEffect(() => {
    if (language) void refetchModels()
  }, [language, refetchModels])

  useEffect(() => {
    if (download && !waiting.watched) setWaiting(current => ({ ...current, watched: true }))
  }, [download, waiting.watched])

  const close = useCallback(() => { setWaiting(current => ({ ...current, closing: true })) }, [])
  const exited = useCallback(() => {
    setCancelling(false)
    setWaiting(current => ({ languages: current.closing ? current.languages.slice(1) : current.languages, closing: false, watched: false, shown: false }))
  }, [])

  if (!language) return { onQueueEvent, dialog: null }

  const row = models.data?.find(model => model.kind === 'alignment' && model.id === language)
  const installed = !!row?.installed
  const failed = waiting.watched && !download && downloads.outcome(language) === 'failed'
  const jobs = alignmentRetryJobs(language, queue.data)

  const retry = async () => {
    close()
    // Each failed job goes back to the end of the queue, in queue order.
    for (const job of jobs) {
      try {
        await api.retryQueueJob(job.id)
      } catch (error) {
        toast({ message: `Could not retry ${job.title}: ${error instanceof ApiError ? error.message : String(error)}`, type: 'error' })
      }
    }
  }

  const dialog: AlignmentDialogProps = {
    open: waiting.shown && !waiting.closing,
    language,
    size: row?.size,
    state: alignmentState({ downloading: !!download, installed, failed }),
    pct: download?.pct ?? 0,
    retryCount: jobs.length,
    cancelling,
    // A download that only did not finish keeps the dialog's own words, which point to Settings.
    failure: failed && downloads.failure(language) !== 'failed' ? downloadFailureLine(downloads.failure(language)!) : undefined,
    onDownload: () => {
      setWaiting(current => ({ ...current, watched: true }))
      void downloads.start(language)
    },
    onCancel: () => {
      setCancelling(true)
      void downloads.cancel(language).finally(close)
    },
    onRetry: () => void retry(),
    onClose: close,
    onOpenSettings: () => {
      close()
      settingsDialog.open('alignment')
    },
    onExited: exited,
  }
  return { onQueueEvent, dialog }
}
