import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { PHOTO_SIZE } from './crop'
import { PhotoCropModal } from './PhotoCropModal'

afterEach(() => vi.restoreAllMocks())

function setup(props = {}) {
  const handlers = { onSave: vi.fn(async () => {}), onClose: vi.fn() }
  render(<OverlayProvider><PhotoCropModal src="blob:picture" {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const image = () => screen.getByRole('dialog').querySelector('img')!
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

function load(width: number, height: number) {
  Object.defineProperty(image(), 'naturalWidth', { value: width })
  Object.defineProperty(image(), 'naturalHeight', { value: height })
  fireEvent.load(image())
}

test('Save waits for the picture', () => {
  setup()
  expect(save().disabled).toBe(true)
  load(400, 200)
  expect(save().disabled).toBe(false)
})

test('a wide picture starts in its middle, its height filling the square', () => {
  setup()
  load(400, 200)
  expect(image().style.left).toBe('-50%')
  expect(image().style.top).toBe('0%')
  expect(image().style.width).toBe('200%')
  expect(image().style.height).toBe('100%')
})

test('arrow keys move the picture, never past its edge', async () => {
  setup()
  load(400, 200)
  screen.getByRole('group', { name: 'Photo position' }).focus()
  await userEvent.keyboard('{ArrowLeft}')
  expect(image().style.left).toBe('-48%')
  await userEvent.keyboard('{ArrowUp}')
  expect(image().style.top).toBe('0%')
})

test('dragging moves the picture by as much as the pointer', () => {
  setup()
  load(400, 200)
  const stage = screen.getByRole('group', { name: 'Photo position' })
  stage.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
  fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(stage, { clientX: 80, clientY: 100, pointerId: 1 })
  expect(image().style.left).toBe('-60%')
  fireEvent.pointerUp(stage, { pointerId: 1 })
})

test('Save draws the square at the size kept and hands it over', async () => {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const blob = new Blob(['x'], { type: 'image/jpeg' })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(blob))
  const { onSave } = setup()
  load(400, 200)
  await userEvent.click(save())
  expect(drawImage).toHaveBeenCalledWith(image(), 100, 0, 200, 200, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
  expect(onSave).toHaveBeenCalledWith(blob)
})

test('a refused photo keeps the window open with why', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['x'])))
  setup({ onSave: () => Promise.reject(new Error('The photo is larger than 2 MB')) })
  load(100, 100)
  await userEvent.click(save())
  await waitFor(() => expect(screen.getByText('The photo is larger than 2 MB')).toBeTruthy())
  expect(screen.getByRole('dialog')).toBeTruthy()
})

test('Cancel closes', async () => {
  const { onClose } = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
})
