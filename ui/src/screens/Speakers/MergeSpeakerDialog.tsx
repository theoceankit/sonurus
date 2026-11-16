import type { Speaker } from '../../api/types'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { mergeSpeakerPrompt } from './speakers'

interface MergeSpeakerDialogProps {
  from: Speaker
  into: Speaker
  open: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
  onExited?: () => void
  preview?: boolean
}

// Over the Speakers window, as Delete is: a merge cannot be undone either.
export function MergeSpeakerDialog({ from, into, open, busy, onConfirm, onClose, onExited, preview }: MergeSpeakerDialogProps) {
  const prompt = mergeSpeakerPrompt(from, into)
  return (
    <Modal type="danger" scrim="clear" open={open} onExited={onExited} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title={prompt.title} />
      <ModalBody>{prompt.body}</ModalBody>
      <ModalFooter confirm={{ children: 'Merge', loading: busy, onClick: onConfirm }} />
    </Modal>
  )
}
