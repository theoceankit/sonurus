import { useDeleteQueueJob } from '../../api/queries'
import type { QueueJob } from '../../api/types'
import { ApiError } from '../../api/client'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { toast } from '../../components/Toast/toast-store'
import { deleteJobPrompt } from './queue'

interface DeleteJobDialogProps {
  job: QueueJob
  open: boolean
  onClose: () => void
  onExited: () => void
}

// The confirmation of the delete button of a queue card. A job already gone (it
// finished meanwhile) counts as deleted.
export function DeleteJobDialog({ job, open, onClose, onExited }: DeleteJobDialogProps) {
  const { mutateAsync: remove, isPending } = useDeleteQueueJob()
  const prompt = deleteJobPrompt(job)

  const confirm = async () => {
    try {
      await remove(job.id)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        toast({ message: `Could not delete: ${(error as Error).message}`, type: 'error' })
      }
    }
    onClose()
  }

  return (
    <Modal type="danger" open={open} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title={prompt.title} />
      <ModalBody><div>{prompt.body}</div></ModalBody>
      <ModalFooter confirm={{ children: 'Delete', loading: isPending, onClick: () => void confirm() }} />
    </Modal>
  )
}
