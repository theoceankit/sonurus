import { useDeleteTranscript } from '../../api/queries'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { toast } from '../../components/Toast/toast'
import { deleteRecordingPrompt } from './recordings'

export interface RecordingToDelete {
  id: number
  title: string
}

interface DeleteRecordingDialogProps {
  recording: RecordingToDelete
  open: boolean
  onDeleted: () => void
  onClose: () => void
  onExited: () => void
}

export function DeleteRecordingDialog({ recording: { id, title }, open, onDeleted, onClose, onExited }: DeleteRecordingDialogProps) {
  const { mutateAsync: remove, isPending } = useDeleteTranscript()
  const prompt = deleteRecordingPrompt(title)

  const confirm = async () => {
    try {
      await remove(id)
      onDeleted()
      toast({ message: `Deleted "${title}".` })
    } catch (error) {
      toast({ message: `Could not delete: ${(error as Error).message}`, type: 'error' })
    }
    onClose()
  }

  return (
    <Modal type="danger" open={open} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title={prompt.title} />
      <ModalBody><div>{prompt.body}<br />{prompt.warning}</div></ModalBody>
      <ModalFooter confirm={{ children: 'Delete', loading: isPending, onClick: () => void confirm() }} />
    </Modal>
  )
}
