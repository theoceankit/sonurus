import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'

interface DiscardChangesDialogProps {
  open: boolean
  onDiscard: () => void
  onClose: () => void
  onExited?: () => void
  preview?: boolean
}

// Over the Speakers window, when a card with edits is left before Save.
export function DiscardChangesDialog({ open, onDiscard, onClose, onExited, preview }: DiscardChangesDialogProps) {
  return (
    <Modal type="danger" scrim="clear" open={open} onExited={onExited} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Discard changes?" />
      <ModalBody>The name and colour you changed are not saved yet.</ModalBody>
      <ModalFooter cancel={{ children: 'Keep editing' }} confirm={{ children: 'Discard', onClick: onDiscard }} />
    </Modal>
  )
}
