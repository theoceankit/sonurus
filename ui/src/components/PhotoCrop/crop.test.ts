import { describe, expect, test } from 'vitest'
import { centredCrop, clampCrop, MAX_ZOOM, panCrop, shownSize, sourceRect, zoomCrop } from './crop'

describe('crop', () => {
  test('at zoom 1 the shorter side fills the square, and the picture starts in the middle', () => {
    expect(shownSize(400, 200, 1)).toEqual({ width: 2, height: 1 })
    expect(centredCrop(400, 200)).toEqual({ zoom: 1, x: -0.5, y: 0 })
    expect(centredCrop(200, 400)).toEqual({ zoom: 1, x: 0, y: -0.5 })
  })

  test('no edge of the picture comes inside the square', () => {
    expect(clampCrop({ zoom: 1, x: 0.3, y: -0.2 }, 400, 200)).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(clampCrop({ zoom: 1, x: -3, y: 0 }, 400, 200)).toEqual({ zoom: 1, x: -1, y: 0 })
    expect(panCrop(centredCrop(400, 200), 400, 200, -0.7, 0)).toEqual({ zoom: 1, x: -1, y: 0 })
  })

  test('zoom stays between 1 and the most', () => {
    expect(clampCrop({ zoom: 0.5, x: 0, y: 0 }, 100, 100).zoom).toBe(1)
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, 100, 100).zoom).toBe(MAX_ZOOM)
  })

  test('zooming keeps the middle of the square where it was', () => {
    const zoomed = zoomCrop(centredCrop(100, 100), 100, 100, 2)
    expect(zoomed).toEqual({ zoom: 2, x: -0.5, y: -0.5 })
    expect(sourceRect(zoomed, 100, 100)).toEqual({ sx: 25, sy: 25, size: 50 })
    // Back out, the picture covers the square again.
    expect(zoomCrop({ zoom: 2, x: -1, y: -1 }, 100, 100, 1)).toEqual({ zoom: 1, x: 0, y: 0 })
  })

  test('the source is the part inside the square, in the picture\'s pixels', () => {
    expect(sourceRect(centredCrop(400, 200), 400, 200)).toEqual({ sx: 100, sy: 0, size: 200 })
    expect(sourceRect({ zoom: 2, x: -1, y: -0.5 }, 400, 200)).toEqual({ sx: 100, sy: 50, size: 100 })
  })
})
