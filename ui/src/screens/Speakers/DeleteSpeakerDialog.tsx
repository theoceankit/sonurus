import type { Speaker } from '../../api/types'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { deleteSpeakerPrompt } from './speakers'

interface DeleteSpeakerDialogProps {
  speaker: Speaker
  open: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
  onExited?: () => void
  preview?: boolean
}

// Over the Speakers window, which stays dimmed under it.
export function DeleteSpeakerDialog({ speaker, open, busy, onConfirm, onClose, onExited, preview }: DeleteSpeakerDialogProps) {
  const prompt = deleteSpeakerPrompt(speaker)
  return (
    <Modal type="danger" scrim="clear" open={open} onExited={onExited} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title={prompt.title} />
      <ModalBody>{prompt.body}</ModalBody>
      <ModalFooter confirm={{ children: 'Delete', loading: busy, onClick: onConfirm }} />
    </Modal>
  )
}
