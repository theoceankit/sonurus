import { useEffect, useRef, useState } from 'react'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import { ASSIGNABLE_SPEAKER_COLORS, type SpeakerColor } from '../../styles/speaker-colors'
import { Avatar } from '../Avatar/Avatar'
import { Button } from '../Button/Button'
import { ColorPicker } from '../ColorPicker/ColorPicker'
import { Inline } from '../Inline/Inline'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { PhotoCrop, type PhotoCropHandle } from '../PhotoCrop/PhotoCrop'
import { Stack } from '../Stack/Stack'
import styles from './AvatarModal.module.css'
import { useFileDrop } from './file-drop'

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

interface AvatarModalProps {
  // Whose avatar, as it shows now.
  speaker: { name: string; color: SpeakerColor; photo?: string | null }
  open?: boolean
  // Each change is the caller's at once; the window shows what it is given back.
  onColorChange: (color: SpeakerColor) => Promise<void> | void
  // The square cropped from the chosen picture. Rejecting keeps the crop with why.
  onPick: (photo: Blob) => Promise<void> | void
  onRemove: () => Promise<void> | void
  onClose: () => void
  onExited?: () => void
  // A picture already chosen, such as one dropped on the avatar that opened the window.
  initialFile?: File
  // For a story: the window in place.
  preview?: boolean
  // For a story: a picture chosen, on the crop step.
  initialSrc?: string
  initialError?: string
}

// The speaker's avatar in one window: a photo, uploaded or dropped and cropped to the
// circle, or removed, and the speaker's colour.
export function AvatarModal({ speaker, open = true, onColorChange, onPick, onRemove, onClose, onExited, initialFile, preview, initialSrc, initialError }: AvatarModalProps) {
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
  // A picture dropped on the avatar that opened the window.
  const first = useRef(initialFile)
  useEffect(() => {
    if (first.current) choose(first.current)
    first.current = undefined
  }, [])

  const drop = useFileDrop(choose, !src && busy === null)

  const run = async (kind: 'save' | 'remove', action: () => Promise<void> | void) => {
    setBusy(kind)
    setError(undefined)
    try {
      await action()
      setSrc(null)
    } catch (err) {
      setError(message(err))
    } finally {
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
          <ModalHeader title="Avatar" />
          <ModalBody className={styles.body}>
            <div className={styles.dropZone} data-over={drop.over ? '' : undefined} {...drop.handlers}>
              <Avatar {...speaker} size="xlarge" />
              <span className={styles.formats}>{drop.over ? 'Drop the picture to crop it' : `Drop a picture here or upload one. ${PHOTO_FORMATS}`}</span>
            </div>
            <Inline gap={2} justify="center">
              <Button size="small" disabled={busy !== null} onClick={() => input.current?.click()}>{hasPhoto ? 'Change photo' : 'Upload photo'}</Button>
              {hasPhoto && (
                <Button size="small" variant="ghost" icon="delete" loading={busy === 'remove'} disabled={busy !== null} onClick={() => { void run('remove', onRemove) }}>Remove photo</Button>
              )}
            </Inline>
            {errorText}
            <Stack className={styles.colour}>
              <ColorPicker label="Colour" value={speaker.color} colors={ASSIGNABLE_SPEAKER_COLORS} disabled={busy !== null} onValueChange={next => { void Promise.resolve(onColorChange(next)).catch(err => setError(message(err))) }} />
            </Stack>
          </ModalBody>
          <ModalFooter cancel={null} confirm={{ children: 'Done', onClick: onClose }} />
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
