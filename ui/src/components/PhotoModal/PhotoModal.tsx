import { useEffect, useRef, useState } from 'react'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { Button } from '../Button/Button'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { PhotoCrop, type PhotoCropHandle } from '../PhotoCrop/PhotoCrop'
import styles from './PhotoModal.module.css'

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// Of the picture as chosen; what is kept is a small square.
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024
export const PHOTO_FORMATS = 'JPEG, PNG or WebP, up to 20 MB.'

// Why a chosen file cannot be a photo, or undefined.
export function photoProblem(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Choose a JPEG, PNG or WebP picture.'
  if (file.size > PHOTO_MAX_BYTES) return 'The picture is larger than 20 MB.'
  return undefined
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface PhotoModalProps {
  // Whose photo, as their avatar shows it now.
  speaker: { name: string; color: SpeakerColor; photo?: string | null }
  open?: boolean
  // The square cropped from the chosen picture. Rejecting keeps the window open with why.
  onPick: (photo: Blob) => Promise<void> | void
  onRemove: () => Promise<void> | void
  onClose: () => void
  onExited?: () => void
  // For a story: the window in place.
  preview?: boolean
  // For a story: a picture chosen, on the crop step.
  initialSrc?: string
  initialError?: string
}

// The speaker's photo in one window: upload one, crop it to the circle, or remove it.
export function PhotoModal({ speaker, open = true, onPick, onRemove, onClose, onExited, preview, initialSrc, initialError }: PhotoModalProps) {
  const input = useRef<HTMLInputElement>(null)
  const crop = useRef<PhotoCropHandle>(null)
  // The chosen picture: an object URL made here, or one a story gives.
  const [src, setSrc] = useState<{ url: string; owned: boolean } | null>(initialSrc ? { url: initialSrc, owned: false } : null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState(initialError)

  useEffect(() => () => { if (src?.owned) URL.revokeObjectURL(src.url) }, [src])

  const choose = (file: File | undefined) => {
    if (!file) return
    const problem = photoProblem(file)
    setError(problem)
    if (problem) return
    setReady(false)
    setSrc({ url: URL.createObjectURL(file), owned: true })
  }

  const run = async (kind: 'save' | 'remove', action: () => Promise<void> | void) => {
    setBusy(kind)
    setError(undefined)
    try {
      await action()
      onClose()
    } catch (err) {
      setError(message(err))
      setBusy(null)
    }
  }

  const back = () => {
    setSrc(null)
    setError(undefined)
  }

  const errorText = error && <span role="alert" className={cx(field.message, field.messageError)}>{error}</span>
  const hasPhoto = Boolean(speaker.photo)
  return (
    <Modal size="small" scrim="auto" open={open} onExited={onExited} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      {src ? (
        <>
          <ModalHeader title="Crop photo" />
          <ModalBody className={styles.body}>
            <PhotoCrop
              key={src.url}
              ref={crop}
              src={src.url}
              onReady={() => setReady(true)}
              onUnreadable={() => {
                back()
                setError('This picture cannot be opened.')
              }}
            />
            {errorText}
          </ModalBody>
          <ModalFooter
            cancel={{ children: 'Back', icon: 'arrow-left', disabled: busy !== null, onClick: back }}
            confirm={{ children: 'Save', disabled: !ready, loading: busy === 'save', onClick: () => { void run('save', async () => onPick(await crop.current!.render())) } }}
          />
        </>
      ) : (
        <>
          <ModalHeader title="Photo" />
          <ModalBody className={styles.body}>
            <Avatar {...speaker} size="large" />
            <span className={styles.formats}>{PHOTO_FORMATS}</span>
            {errorText}
          </ModalBody>
          <ModalFooter
            leading={hasPhoto && (
              <Button variant="ghost" icon="delete" loading={busy === 'remove'} disabled={busy !== null} onClick={() => { void run('remove', onRemove) }}>Remove photo</Button>
            )}
            confirm={{ children: hasPhoto ? 'Change photo' : 'Upload photo', disabled: busy !== null, onClick: () => input.current?.click() }}
          />
        </>
      )}
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        hidden
        aria-label="Photo file"
        onChange={event => {
          choose(event.target.files?.[0])
          // The same file again is a new choice.
          event.target.value = ''
        }}
      />
    </Modal>
  )
}
