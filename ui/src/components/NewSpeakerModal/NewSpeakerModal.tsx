import { useState } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { speakerColor, type SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { ColorPicker } from '../ColorPicker/ColorPicker'
import { Disclosure } from '../Disclosure/Disclosure'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
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
  // For a story: the window in place, and the details open.
  preview?: boolean
  initialDetailsExpanded?: boolean
  initialError?: string
}

export function NewSpeakerModal({
  initialName = '', initialColorIndex = 0, isNameTaken, onCreate, onBack, onClose, preview, initialDetailsExpanded = false, initialError,
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

  const repeated = trimmed && isNameTaken?.(trimmed) ? `Another speaker is also named “${trimmed}”.` : undefined

  return (
    <Modal size="medium" open preview={preview} onOpenChange={open => { if (!open) onClose() }}>
      <ModalHeader title="New speaker" />
      <ModalBody className={styles.body}>
        <div className={styles.identity}>
          <Avatar name={trimmed} color={color} size="large" />
          <TextField
            data-modal-start
            label="Name"
            placeholder="Speaker name"
            maxLength={NAME_MAX_LENGTH}
            className={styles.name}
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
        </div>
        <ColorPicker label="Colour" value={color} onValueChange={setColor} />
        <Disclosure label="Optional details" defaultExpanded={initialDetailsExpanded}>
          <div className={styles.details}>
            <TextField label="Handle" prefix="@" placeholder="olivia.brown" readOnly {...markNotImplemented('new-speaker.handle')} />
            <TextField label="Email" placeholder="name@company.com" readOnly {...markNotImplemented('new-speaker.email')} />
          </div>
        </Disclosure>
      </ModalBody>
      <ModalFooter
        cancel={{ children: 'Back', icon: 'arrow-left', onClick: onBack }}
        confirm={{ children: 'Create and assign', disabled: !trimmed, loading: busy, onClick: () => { void submit() } }}
      />
    </Modal>
  )
}
