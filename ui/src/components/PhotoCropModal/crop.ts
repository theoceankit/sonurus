// Where a picture sits in the square it is cropped in. The square is 1 wide; x and y
// are the picture's top left corner in it, so both are 0 or less. At zoom 1 the
// shorter side of the picture just fills the square.
export type Crop = { zoom: number; x: number; y: number }

export const MAX_ZOOM = 4
// The side of the photo that is kept: enough for the largest avatar on a sharp screen.
export const PHOTO_SIZE = 256

export function shownSize(width: number, height: number, zoom: number) {
  const scale = zoom / Math.min(width, height)
  return { width: width * scale, height: height * scale }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// The picture always covers the square: no edge comes inside it.
export function clampCrop({ zoom, x, y }: Crop, width: number, height: number): Crop {
  const z = clamp(zoom, 1, MAX_ZOOM)
  const shown = shownSize(width, height, z)
  return { zoom: z, x: clamp(x, 1 - shown.width, 0), y: clamp(y, 1 - shown.height, 0) }
}

export function centredCrop(width: number, height: number): Crop {
  const shown = shownSize(width, height, 1)
  return { zoom: 1, x: (1 - shown.width) / 2, y: (1 - shown.height) / 2 }
}

// Zooms about the middle of the square, so what is in the middle stays there.
export function zoomCrop(crop: Crop, width: number, height: number, zoom: number): Crop {
  const z = clamp(zoom, 1, MAX_ZOOM)
  const ratio = z / crop.zoom
  return clampCrop({ zoom: z, x: 0.5 - (0.5 - crop.x) * ratio, y: 0.5 - (0.5 - crop.y) * ratio }, width, height)
}

// dx and dy in widths of the square.
export function panCrop(crop: Crop, width: number, height: number, dx: number, dy: number): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, width, height)
}

// The part of the picture inside the square, in the picture's own pixels.
export function sourceRect({ zoom, x, y }: Crop, width: number, height: number) {
  const scale = zoom / Math.min(width, height)
  return { sx: (0 - x) / scale, sy: (0 - y) / scale, size: 1 / scale }
}

// The square as a JPEG of PHOTO_SIZE pixels.
export function renderCrop(image: HTMLImageElement, crop: Crop): Promise<Blob> {
  const { sx, sy, size } = sourceRect(crop, image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = PHOTO_SIZE
  canvas.height = PHOTO_SIZE
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('The photo could not be drawn.'))
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, size, size, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The photo could not be drawn.'))), 'image/jpeg', 0.9)
  })
}
