import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { PHOTO_SIZE } from './crop'
import { PhotoCrop, type PhotoCropHandle } from './PhotoCrop'

afterEach(() => vi.restoreAllMocks())

function setup(props = {}) {
  const ref = createRef<PhotoCropHandle>()
  const handlers = { onReady: vi.fn(), onUnreadable: vi.fn() }
  const view = render(<PhotoCrop ref={ref} src="blob:picture" {...handlers} {...props} />)
  return { ref, ...handlers, image: view.container.querySelector('img')! }
}

function load(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(image, 'naturalWidth', { value: width })
  Object.defineProperty(image, 'naturalHeight', { value: height })
  fireEvent.load(image)
}

test('a wide picture starts in its middle, its height filling the square', () => {
  const { image, onReady } = setup()
  load(image, 400, 200)
  expect(onReady).toHaveBeenCalled()
  expect(image.style.left).toBe('-50%')
  expect(image.style.top).toBe('0%')
  expect(image.style.width).toBe('200%')
  expect(image.style.height).toBe('100%')
})

test('arrow keys move the picture, never past its edge', async () => {
  const { image } = setup()
  load(image, 400, 200)
  screen.getByRole('group', { name: 'Photo position' }).focus()
  await userEvent.keyboard('{ArrowLeft}')
  expect(image.style.left).toBe('-48%')
  await userEvent.keyboard('{ArrowUp}')
  expect(image.style.top).toBe('0%')
})

test('dragging moves the picture by as much as the pointer', () => {
  const { image } = setup()
  load(image, 400, 200)
  const stage = screen.getByRole('group', { name: 'Photo position' })
  stage.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
  fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(stage, { clientX: 80, clientY: 100, pointerId: 1 })
  expect(image.style.left).toBe('-60%')
  fireEvent.pointerUp(stage, { pointerId: 1 })
})

test('render draws the square at the size kept', async () => {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const blob = new Blob(['x'], { type: 'image/jpeg' })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(blob))
  const { ref, image } = setup()
  load(image, 400, 200)
  expect(await ref.current!.render()).toBe(blob)
  expect(drawImage).toHaveBeenCalledWith(image, 100, 0, 200, 200, 0, 0, PHOTO_SIZE, PHOTO_SIZE)
})

test('render waits for the picture', async () => {
  const { ref } = setup()
  await expect(ref.current!.render()).rejects.toThrow()
})

test('a picture that does not open is said', () => {
  const { image, onUnreadable } = setup()
  fireEvent.error(image)
  expect(onUnreadable).toHaveBeenCalled()
})
