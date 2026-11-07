import { useState } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { ASSIGNABLE_SPEAKER_COLORS, speakerColor, type SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { ColorPicker } from '../ColorPicker/ColorPicker'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { Stack } from '../Stack/Stack'
import { TextField } from '../TextField/TextField'
import styles from './NewSpeakerModal.module.css'

const NAME_MAX_LENGTH = 128

interface NewSpeakerModalProps {
  initialName?: string
  initialColorIndex?: number
  // Names need not be unique; this only tells when one is repeated.
  isNameTaken?: (name: string) => boolean
  // Rejecting keeps the window open with the message.
  onCreate: (name: string, colorIndex: number) => Promise<void>
  onBack: () => void
  onClose: () => void
  open?: boolean
  onExited?: () => void
  skipEnter?: boolean
  // For a story: the window in place.
  preview?: boolean
  initialError?: string
}

export function NewSpeakerModal({
  initialName = '', initialColorIndex = 0, isNameTaken, onCreate, onBack, onClose, open = true, onExited, skipEnter, preview, initialError,
}: NewSpeakerModalProps) {
  const [name, setName] = useState(initialName.trim())
  const [color, setColor] = useState<SpeakerColor>(speakerColor(initialColorIndex))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const trimmed = name.trim()

  const submit = async () => {
    if (!trimmed || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onCreate(trimmed, color - 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const repeated = trimmed && isNameTaken?.(trimmed) ? `Another speaker is also named "${trimmed}".` : undefined

  return (
    <Modal size="small" open={open} onExited={onExited} skipEnter={skipEnter} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="New speaker" />
      <ModalBody className={styles.body}>
        <Avatar name={trimmed} color={color} size="large" />
        <Stack gap={3} className={styles.fields}>
          <TextField
            data-modal-start
            label="Name"
            placeholder="Speaker name"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            helper={repeated}
            error={error}
            onChange={event => {
              setName(event.target.value)
              setError(undefined)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <TextField label="Handle" prefix="@" placeholder="olivia.brown" readOnly {...markNotImplemented('new-speaker.handle')} />
          <ColorPicker label="Colour" value={color} onValueChange={setColor} colors={ASSIGNABLE_SPEAKER_COLORS} />
        </Stack>
      </ModalBody>
      <ModalFooter
        cancel={{ children: 'Back', icon: 'arrow-left', onClick: onBack }}
        confirm={{ children: 'Create and assign', disabled: !trimmed, loading: busy, onClick: () => { void submit() } }}
      />
    </Modal>
  )
}
