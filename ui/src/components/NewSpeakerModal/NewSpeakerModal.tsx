import { useState, type KeyboardEvent } from 'react'
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
  // The handle the name brings, from the backend, shown until a handle is typed.
  suggestedHandle?: string
  // The name as typed, so the parent can ask for its handle.
  onNameChange?: (name: string) => void
  // Why a typed handle cannot be had, or undefined.
  checkHandle?: (handle: string) => string | undefined
  // handle: only one typed; without it the backend makes one from the name.
  // Rejecting keeps the window open with the message; one with a handle_ code shows
  // under the handle.
  onCreate: (name: string, colorIndex: number, handle?: string) => Promise<void>
  onBack: () => void
  onClose: () => void
  open?: boolean
  onExited?: () => void
  skipEnter?: boolean
  // For a story: the window in place.
  preview?: boolean
  initialError?: string
  // For a story: a handle typed in.
  initialHandle?: string
}

export function NewSpeakerModal({
  initialName = '', initialColorIndex = 0, isNameTaken, suggestedHandle, onNameChange, checkHandle, onCreate, onBack, onClose, open = true, onExited, skipEnter, preview, initialError, initialHandle,
}: NewSpeakerModalProps) {
  const [name, setName] = useState(initialName.trim())
  const [color, setColor] = useState<SpeakerColor>(speakerColor(initialColorIndex))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  // null until typed in: the handle the name brings is shown then.
  const [handle, setHandle] = useState<string | null>(initialHandle ?? null)
  const [handleError, setHandleError] = useState<string>()
  const trimmed = name.trim()
  const typed = handle?.trim() ?? ''
  const handleIssue = typed ? checkHandle?.(typed) : undefined

  const submit = async () => {
    if (!trimmed || handleIssue || busy) return
    setBusy(true)
    setError(undefined)
    setHandleError(undefined)
    try {
      await (typed ? onCreate(trimmed, color - 1, typed) : onCreate(trimmed, color - 1))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: unknown } | null)?.code
      if (typeof code === 'string' && code.startsWith('handle_')) setHandleError(message)
      else setError(message)
      setBusy(false)
    }
  }

  const enter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
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
              onNameChange?.(event.target.value)
            }}
            onKeyDown={enter}
          />
          <TextField
            label="Handle"
            prefix="@"
            value={handle ?? (trimmed ? suggestedHandle ?? '' : '')}
            placeholder={trimmed && handle === '' ? suggestedHandle : 'olivia.brown'}
            helper={trimmed && handle === '' ? 'Left empty, the handle is made from the name.' : undefined}
            error={handleError ?? handleIssue}
            spellCheck={false}
            autoCapitalize="off"
            onChange={event => {
              // Lowercase as typed; the @ is the field's own.
              setHandle(event.target.value.replace(/^\s*@+/, '').toLowerCase())
              setHandleError(undefined)
            }}
            onKeyDown={enter}
          />
          <ColorPicker label="Colour" value={color} onValueChange={setColor} colors={ASSIGNABLE_SPEAKER_COLORS} />
        </Stack>
      </ModalBody>
      <ModalFooter
        cancel={{ children: 'Back', icon: 'arrow-left', onClick: onBack }}
        confirm={{ children: 'Create and assign', disabled: !trimmed || !!handleIssue, loading: busy, onClick: () => { void submit() } }}
      />
    </Modal>
  )
}
