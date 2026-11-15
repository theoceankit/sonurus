import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Slider } from '../Slider/Slider'
import { Stack } from '../Stack/Stack'
import { centredCrop, MAX_ZOOM, panCrop, renderCrop, shownSize, zoomCrop, type Crop } from './crop'
import styles from './PhotoCrop.module.css'

// An arrow key moves the picture by this part of the square.
const KEY_STEP = 0.02
const ZOOM_STEP = 0.25

export interface PhotoCropHandle {
  // The square as a JPEG; rejects before the picture has loaded.
  render: () => Promise<Blob>
}

interface PhotoCropProps {
  // The picture as chosen, such as an object URL of the file.
  src: string
  // The picture has loaded and can be cropped.
  onReady?: () => void
  // The picture cannot be shown: not an image after all.
  onUnreadable?: () => void
  // For a story: zoomed in from the start.
  initialZoom?: number
}

// Drag the picture and zoom it until the circle holds the face.
export const PhotoCrop = forwardRef<PhotoCropHandle, PhotoCropProps>(function PhotoCrop({ src, onReady, onUnreadable, initialZoom }, ref) {
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; width: number; crop: Crop } | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  useImperativeHandle(ref, () => ({
    render: () => (size ? renderCrop(image.current!, crop) : Promise.reject(new Error('The picture has not loaded yet.'))),
  }), [size, crop])

  const loaded = () => {
    const { naturalWidth: width, naturalHeight: height } = image.current!
    setSize({ width, height })
    const centred = centredCrop(width, height)
    setCrop(initialZoom ? zoomCrop(centred, width, height, initialZoom) : centred)
    onReady?.()
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

  const shown = size ? shownSize(size.width, size.height, crop.zoom) : null
  return (
    <Stack gap={3} align="center" className={styles.photoCrop}>
      <div
        className={styles.stage}
        role="group"
        aria-label="Photo position"
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
    </Stack>
  )
})
