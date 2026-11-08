import { useEffect, useState } from 'react'
import { useQueue, useRetryQueueJob } from '../../api/queries'
import type { QueueJob } from '../../api/types'
import { useLingering } from '../../presence'
import { DeleteJobDialog } from './DeleteJobDialog'
import { EditJobDialog } from './EditJobDialog'
import { jobStatusText } from './queue'
import { QueueJobView } from './QueueJobView'
import { refused } from './queue-toasts'

interface QueueJobPanelProps {
  jobId: string
  // The job left the queue: it was deleted, or it finished.
  onGone: () => void
}

// The centre for a job picked in the queue. It follows the job's snapshots, so a
// retried job turns from failed to waiting here too.
export function QueueJobPanel({ jobId, onGone }: QueueJobPanelProps) {
  const { data: snapshot } = useQueue()
  const retry = useRetryQueueJob()
  const [editing, setEditing] = useState<QueueJob | null>(null)
  const [toDelete, setToDelete] = useState<QueueJob | null>(null)
  const deleteDialog = useLingering(toDelete)
  const job = snapshot?.jobs.find(j => j.id === jobId) ?? null

  useEffect(() => {
    if (snapshot && !job) onGone()
  }, [snapshot, job, onGone])

  return (
    <>
      {snapshot && job && (
        <QueueJobView
          title={job.title}
          status={job.status}
          statusText={jobStatusText(job, snapshot)}
          error={job.error}
          retrying={retry.isPending}
          onRetry={() => retry.mutate(job.id, { onError: refused })}
          onEdit={() => setEditing(job)}
          onDelete={() => setToDelete(job)}
        />
      )}
      <EditJobDialog job={editing} onClose={() => setEditing(null)} />
      {deleteDialog.value && (
        <DeleteJobDialog
          key={deleteDialog.key}
          job={deleteDialog.value}
          open={deleteDialog.open}
          onClose={() => setToDelete(null)}
          onExited={deleteDialog.exited}
        />
      )}
    </>
  )
}
