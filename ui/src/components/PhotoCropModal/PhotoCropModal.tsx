import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { Slider } from '../Slider/Slider'
import { cx } from '../../styles/cx'
import field from '../../styles/field.module.css'
import { centredCrop, MAX_ZOOM, panCrop, renderCrop, shownSize, zoomCrop, type Crop } from './crop'
import styles from './PhotoCropModal.module.css'

// An arrow key moves the picture by this part of the square.
const KEY_STEP = 0.02
const ZOOM_STEP = 0.25

interface PhotoCropModalProps {
  // The picture as chosen, such as an object URL of the file.
  src: string
  open?: boolean
  // The square as a JPEG. Rejecting keeps the window open with the message.
  onSave: (photo: Blob) => Promise<void> | void
  onClose: () => void
  // The picture cannot be shown: not an image after all.
  onUnreadable?: () => void
  onExited?: () => void
  // For a story: zoomed in from the start.
  initialZoom?: number
  // For a story: the window in place.
  preview?: boolean
}

// Drag the picture and zoom it until the circle holds the face; Save keeps that square.
export function PhotoCropModal({ src, open = true, onSave, onClose, onUnreadable, onExited, initialZoom, preview }: PhotoCropModalProps) {
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; width: number; crop: Crop } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const loaded = () => {
    const { naturalWidth: width, naturalHeight: height } = image.current!
    setSize({ width, height })
    const centred = centredCrop(width, height)
    setCrop(initialZoom ? zoomCrop(centred, width, height, initialZoom) : centred)
  }

  const pan = (dx: number, dy: number, from = crop) => size && setCrop(panCrop(from, size.width, size.height, dx, dy))
  const zoom = (next: number) => size && setCrop(zoomCrop(crop, size.width, size.height, next))

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!size || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, width: event.currentTarget.getBoundingClientRect().width, crop }
    setDragging(true)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || !start.width) return
    pan((event.clientX - start.x) / start.width, (event.clientY - start.y) / start.width, start.crop)
  }
  const pointerUp = () => {
    drag.current = null
    setDragging(false)
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP],
    }
    if (moves[event.key]) pan(...moves[event.key])
    else if (event.key === '+' || event.key === '=') zoom(crop.zoom + ZOOM_STEP)
    else if (event.key === '-') zoom(crop.zoom - ZOOM_STEP)
    else return
    event.preventDefault()
  }

  const save = async () => {
    if (!size || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onSave(await renderCrop(image.current!, crop))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const shown = size ? shownSize(size.width, size.height, crop.zoom) : null
  return (
    <Modal size="small" scrim="auto" open={open} onExited={onExited} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Crop photo" />
      <ModalBody className={styles.body}>
        <div
          className={styles.stage}
          role="group"
          aria-label="Photo position"
          aria-describedby={error ? 'photo-crop-error' : undefined}
          tabIndex={0}
          data-modal-start
          data-dragging={dragging ? '' : undefined}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onKeyDown={key}
        >
          <img
            ref={image}
            className={styles.image}
            src={src}
            alt=""
            draggable={false}
            onLoad={loaded}
            onError={onUnreadable}
            style={shown ? { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` } : { visibility: 'hidden' }}
          />
          <div className={styles.mask} aria-hidden />
        </div>
        <Slider label="Zoom" orientation="horizontal" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} disabled={!size} onChange={zoom} valueText={value => `${Math.round(value * 100)}%`} />
        {error && <span id="photo-crop-error" className={cx(field.message, field.messageError)}>{error}</span>}
      </ModalBody>
      <ModalFooter confirm={{ children: 'Save', disabled: !size, loading: busy, onClick: () => { void save() } }} />
    </Modal>
  )
}
