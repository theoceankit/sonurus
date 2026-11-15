import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { PHOTO_MAX_BYTES, PhotoPicker, photoProblem } from './PhotoPicker'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:picture')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

function setup(props = {}) {
  const handlers = { onPick: vi.fn(), onRemove: vi.fn() }
  render(<OverlayProvider><PhotoPicker label="Photo" hasPhoto={false} {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const choose = (file: File) => fireEvent.change(screen.getByLabelText('Photo file'), { target: { files: [file] } })

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

test('without a photo there is only Upload photo', () => {
  setup()
  expect(screen.getByRole('button', { name: 'Upload photo' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()
})

test('with one it can be changed or removed', async () => {
  const { onRemove } = setup({ hasPhoto: true })
  expect(screen.getByRole('button', { name: 'Change photo' })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
  expect(onRemove).toHaveBeenCalled()
})

test('the file chooser takes only pictures', () => {
  setup()
  expect(screen.getByLabelText('Photo file').getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
})

test('a picture opens the crop window', () => {
  setup()
  choose(new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
  expect(screen.getByRole('dialog', { name: 'Crop photo' })).toBeTruthy()
  expect(URL.createObjectURL).toHaveBeenCalled()
})

test('another file says why and opens nothing', () => {
  setup()
  choose(new File(['x'], 'me.gif', { type: 'image/gif' }))
  expect(screen.getByText('Choose a JPEG, PNG or WebP picture.')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a picture that does not open says so', () => {
  setup()
  choose(new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
  fireEvent.error(screen.getByRole('dialog').querySelector('img')!)
  expect(screen.getByText('This picture cannot be opened.')).toBeTruthy()
})

test('disabled with why', () => {
  setup({ disabled: true, hint: 'Add a name to add a photo.' })
  expect((screen.getByRole('button', { name: 'Upload photo' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Add a name to add a photo.')).toBeTruthy()
})
