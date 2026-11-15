import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import { Button } from '../Button/Button'
import { Inline } from '../Inline/Inline'
import { PhotoCropModal } from '../PhotoCropModal/PhotoCropModal'
import { Stack } from '../Stack/Stack'
import styles from './PhotoPicker.module.css'

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// Of the picture as chosen; what is kept is a small square.
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024

// Why a chosen file cannot be a photo, or undefined.
export function photoProblem(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Choose a JPEG, PNG or WebP picture.'
  if (file.size > PHOTO_MAX_BYTES) return 'The picture is larger than 20 MB.'
  return undefined
}

interface PhotoPickerProps {
  label?: string
  hasPhoto: boolean
  disabled?: boolean
  // Said under the buttons: why there can be no photo yet, for one.
  hint?: string
  // Why the last photo was not kept.
  error?: string
  // Uploading or removing: the buttons wait.
  busy?: boolean
  // The square cropped from the chosen picture. Rejecting keeps the crop window open
  // with the message.
  onPick: (photo: Blob) => Promise<void> | void
  onRemove: () => void
}

// Choose a picture, crop it to the circle, or take the photo away.
export function PhotoPicker({ label, hasPhoto, disabled, hint, error, busy, onPick, onRemove }: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const [src, setSrc] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<string>()

  // The picture is let go when the crop window has gone, or the picker with it.
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const choose = (file: File | undefined) => {
    if (!file) return
    const issue = photoProblem(file)
    setProblem(issue)
    if (issue) return
    setSrc(URL.createObjectURL(file))
    setOpen(true)
  }

  const message = problem ?? error ?? hint
  return (
    <Stack gap={1}>
      {label && <span id={labelId} className={styles.label}>{label}</span>}
      <Inline gap={2} role="group" aria-labelledby={label ? labelId : undefined}>
        <Button size="small" disabled={disabled} loading={busy} onClick={() => input.current?.click()}>
          {hasPhoto ? 'Change photo' : 'Upload photo'}
        </Button>
        {hasPhoto && <Button size="small" variant="ghost" disabled={disabled || busy} onClick={onRemove}>Remove photo</Button>}
      </Inline>
      {message && <span className={cx(field.message, (problem ?? error) && field.messageError)}>{message}</span>}
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
      {src && (
        <PhotoCropModal
          src={src}
          open={open}
          onSave={async photo => {
            await onPick(photo)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
          onUnreadable={() => {
            setProblem('This picture cannot be opened.')
            setOpen(false)
          }}
          onExited={() => setSrc(null)}
        />
      )}
    </Stack>
  )
}
