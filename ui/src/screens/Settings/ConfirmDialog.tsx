import { useState } from 'react'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'

export type ConfirmPrompt = { title: string; body: string; confirmLabel: string }

interface ConfirmDialogProps {
  prompt: ConfirmPrompt
  open: boolean
  // What is confirmed; the window stays, with the button busy, until it is done.
  onConfirm: () => Promise<void>
  onClose: () => void
  onExited?: () => void
  // The scrim under it: Settings already dims the window.
  scrim?: 'dim' | 'clear'
}

// A destructive step of Settings, asked over Settings: closing it leaves Settings open.
export function ConfirmDialog({ prompt, open, onConfirm, onClose, onExited, scrim = 'dim' }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      onClose()
    }
  }
  return (
    <Modal size="small" type="danger" scrim={scrim} open={open} onExited={onExited} onOpenChange={next => { if (!next && !busy) onClose() }}>
      <ModalHeader title={prompt.title} />
      <ModalBody>{prompt.body}</ModalBody>
      <ModalFooter cancel={{ children: 'Cancel', disabled: busy }} confirm={{ children: prompt.confirmLabel, loading: busy, onClick: () => void confirm() }} />
    </Modal>
  )
}
