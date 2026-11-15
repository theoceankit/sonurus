import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { AvatarModal, PHOTO_MAX_BYTES, photoProblem } from './AvatarModal'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:picture')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

function setup(props = {}) {
  const handlers = { onColorChange: vi.fn(), onPick: vi.fn(async () => {}), onRemove: vi.fn(async () => {}), onClose: vi.fn() }
  render(<OverlayProvider><AvatarModal speaker={{ name: 'Anna Petrova', color: 1 }} {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const choose = (file: File) => fireEvent.change(screen.getByLabelText('Photo file'), { target: { files: [file] } })
const jpeg = () => new File(['x'], 'me.jpg', { type: 'image/jpeg' })
const files = (file: File) => ({ dataTransfer: { types: ['Files'], files: [file], dropEffect: 'none' } })
const dropZone = () => screen.getByText('Drop a picture here').closest('[class*="dropZone"]') as HTMLElement

function loadCrop() {
  const image = screen.getByRole('dialog').querySelector('img') as HTMLImageElement
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

test('the large avatar in a drop zone with Choose file, the formats on a line of their own, and the colour; Done closes', async () => {
  const { onClose } = setup()
  const dialog = screen.getByRole('dialog', { name: 'Avatar' })
  expect(dialog.querySelector('[class*="xlarge"]')).toBeTruthy()
  const zone = dropZone()
  expect(within(zone).getByText('Drop a picture here')).toBeTruthy()
  expect(within(zone).getByText('JPEG, PNG or WebP, up to 20 MB.')).toBeTruthy()
  expect(within(zone).getByRole('button', { name: 'Choose file' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()
  expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy()
  expect(screen.getByLabelText('Photo file').getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onClose).toHaveBeenCalled()
})

test('a colour chosen is handed over at once', async () => {
  const { onColorChange } = setup()
  await userEvent.click(screen.getByRole('radio', { name: 'Tangerine' }))
  expect(onColorChange).toHaveBeenCalledWith(4)
})

test('a refused colour says why', async () => {
  setup({ onColorChange: () => Promise.reject(new Error('Server error 500')) })
  await userEvent.click(screen.getByRole('radio', { name: 'Tangerine' }))
  expect(await screen.findByText('Server error 500')).toBeTruthy()
})

test('a photo shows; Remove photo takes it away and the window stays', async () => {
  const { onRemove, onClose } = setup({ speaker: { name: 'Anna Petrova', color: 1, photo: 'data:image/jpeg;base64,x' } })
  expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,x')
  expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(onRemove).toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

test('a refused removal says why', async () => {
  setup({ speaker: { name: 'Anna', color: 1, photo: 'p.jpg' }, onRemove: () => Promise.reject(new Error('Server error 500')) })
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(await screen.findByText('Server error 500')).toBeTruthy()
})

test('a chosen picture is cropped in the window; Save hands the square over and comes back', async () => {
  const blob = canvas()
  const { onPick, onClose } = setup()
  choose(jpeg())
  expect(screen.getByRole('group', { name: 'Photo position' })).toBeTruthy()
  const save = screen.getByRole('button', { name: 'Save photo' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  loadCrop()
  await userEvent.click(save)
  expect(onPick).toHaveBeenCalledWith(blob)
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Photo position' })).toBeNull())
  expect(screen.getByRole('dialog', { name: 'Avatar' })).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
})

test('a picture dropped on the avatar is cropped in the window; files over it change what it says', () => {
  setup()
  const zone = dropZone()
  fireEvent.dragEnter(zone, files(jpeg()))
  expect(zone.hasAttribute('data-over')).toBe(true)
  expect(screen.getByText('Drop to add the picture')).toBeTruthy()
  fireEvent.drop(zone, files(jpeg()))
  expect(screen.getByRole('group', { name: 'Photo position' })).toBeTruthy()
})

test('a dropped file of another kind says why', () => {
  setup()
  fireEvent.drop(dropZone(), files(new File(['x'], 'notes.txt', { type: 'text/plain' })))
  expect(screen.getByText('Choose a JPEG, PNG or WebP picture.')).toBeTruthy()
  expect(screen.getByRole('dialog', { name: 'Avatar' })).toBeTruthy()
})

test('the crop is in the same window, its title and colour staying; Done waits for it', () => {
  setup()
  choose(jpeg())
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: 'Avatar' })).toBeTruthy()
  expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true)
})

test('a picture given at the start opens on its crop', () => {
  setup({ initialFile: jpeg() })
  expect(screen.getByRole('group', { name: 'Photo position' })).toBeTruthy()
})

test('Cancel leaves the crop without saving', async () => {
  const { onPick } = setup()
  choose(jpeg())
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('dialog', { name: 'Avatar' })).toBeTruthy()
  expect(onPick).not.toHaveBeenCalled()
})

test('a refused photo stays on the crop with why', async () => {
  canvas()
  setup({ onPick: () => Promise.reject(new Error('The photo is larger than 2 MB')) })
  choose(jpeg())
  loadCrop()
  await userEvent.click(screen.getByRole('button', { name: 'Save photo' }))
  expect(await screen.findByText('The photo is larger than 2 MB')).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Photo position' })).toBeTruthy()
})

test('a picture that does not open goes back and says so', () => {
  setup()
  choose(jpeg())
  fireEvent.error(screen.getByRole('dialog').querySelector('img')!)
  expect(screen.getByRole('dialog', { name: 'Avatar' })).toBeTruthy()
  expect(screen.getByText('This picture cannot be opened.')).toBeTruthy()
})
