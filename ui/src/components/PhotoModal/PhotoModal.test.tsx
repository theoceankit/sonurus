import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { PHOTO_MAX_BYTES, PhotoModal, photoProblem } from './PhotoModal'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:picture')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

function setup(props = {}) {
  const handlers = { onPick: vi.fn(async () => {}), onRemove: vi.fn(async () => {}), onClose: vi.fn() }
  render(<OverlayProvider><PhotoModal speaker={{ name: 'Anna Petrova', color: 1 }} {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const choose = (file: File) => fireEvent.change(screen.getByLabelText('Photo file'), { target: { files: [file] } })
const jpeg = () => new File(['x'], 'me.jpg', { type: 'image/jpeg' })

function loadCrop() {
  const image = screen.getByRole('dialog').querySelector('img:not([data-photo] img)') as HTMLImageElement
  Object.defineProperty(image, 'naturalWidth', { value: 300 })
  Object.defineProperty(image, 'naturalHeight', { value: 300 })
  fireEvent.load(image)
}

function canvas() {
  const blob = new Blob(['photo'], { type: 'image/jpeg' })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(done => done(blob))
  return blob
}

test.each([
  [{ type: 'image/jpeg', size: 10 }, undefined],
  [{ type: 'image/png', size: PHOTO_MAX_BYTES }, undefined],
  [{ type: 'image/webp', size: 10 }, undefined],
  [{ type: 'image/gif', size: 10 }, 'Choose a JPEG, PNG or WebP picture.'],
  [{ type: '', size: 10 }, 'Choose a JPEG, PNG or WebP picture.'],
  [{ type: 'image/jpeg', size: PHOTO_MAX_BYTES + 1 }, 'The picture is larger than 20 MB.'],
])('%j: %s', (file, problem) => {
  expect(photoProblem(file)).toBe(problem)
})

test('says which pictures can be a photo; without one there is only Upload photo', () => {
  setup()
  expect(screen.getByRole('dialog', { name: 'Photo' })).toBeTruthy()
  expect(screen.getByText('JPEG, PNG or WebP, up to 20 MB.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Upload photo' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()
  expect(screen.getByLabelText('Photo file').getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
})

test('a photo shows, and can be changed or removed', async () => {
  const { onRemove, onClose } = setup({ speaker: { name: 'Anna Petrova', color: 1, photo: 'data:image/jpeg;base64,x' } })
  expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,x')
  expect(screen.getByRole('button', { name: 'Change photo' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(onRemove).toHaveBeenCalled()
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

test('a refused removal keeps the window with why', async () => {
  const { onClose } = setup({ speaker: { name: 'Anna', color: 1, photo: 'p.jpg' }, onRemove: () => Promise.reject(new Error('Server error 500')) })
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(await screen.findByText('Server error 500')).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})

test('a picture goes to Crop photo; Save hands the square over and closes', async () => {
  const blob = canvas()
  const { onPick, onClose } = setup()
  choose(jpeg())
  expect(screen.getByRole('dialog', { name: 'Crop photo' })).toBeTruthy()
  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  loadCrop()
  await userEvent.click(save)
  expect(onPick).toHaveBeenCalledWith(blob)
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

test('Back returns to the photo without saving', async () => {
  const { onPick } = setup()
  choose(jpeg())
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('dialog', { name: 'Photo' })).toBeTruthy()
  expect(onPick).not.toHaveBeenCalled()
})

test('a refused photo stays on the crop with why', async () => {
  canvas()
  const { onClose } = setup({ onPick: () => Promise.reject(new Error('The photo is larger than 2 MB')) })
  choose(jpeg())
  loadCrop()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('The photo is larger than 2 MB')).toBeTruthy()
  expect(screen.getByRole('dialog', { name: 'Crop photo' })).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})

test('another file says why and stays', () => {
  setup()
  choose(new File(['x'], 'me.gif', { type: 'image/gif' }))
  expect(screen.getByText('Choose a JPEG, PNG or WebP picture.')).toBeTruthy()
  expect(screen.getByRole('dialog', { name: 'Photo' })).toBeTruthy()
})

test('a picture that does not open goes back and says so', () => {
  setup()
  choose(jpeg())
  fireEvent.error(screen.getByRole('dialog').querySelector('img')!)
  expect(screen.getByRole('dialog', { name: 'Photo' })).toBeTruthy()
  expect(screen.getByText('This picture cannot be opened.')).toBeTruthy()
})
