import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { dismissAllToasts } from '../Toast/toast-store'
import { NewSpeakerModal } from './NewSpeakerModal'

afterEach(dismissAllToasts)

function setup(props = {}) {
  const handlers = { onCreate: vi.fn(async () => {}), onBack: vi.fn(), onClose: vi.fn() }
  render(<OverlayProvider><NewSpeakerModal {...handlers} {...props} /></OverlayProvider>)
  return handlers
}

const create = () => screen.getByRole('button', { name: 'Create and assign' }) as HTMLButtonElement
const name = () => screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement

test('starts in the name, filled from the search', () => {
  setup({ initialName: '  Zoe ' })
  expect(document.activeElement).toBe(name())
  expect(name().value).toBe('Zoe')
})

test('the avatar shows the initials as they are typed', async () => {
  setup()
  await userEvent.type(name(), 'Olivia Brown')
  expect(screen.getByText('OB')).toBeTruthy()
})

test('an empty name creates nothing', async () => {
  const { onCreate } = setup()
  expect(create().disabled).toBe(true)
  await userEvent.type(name(), '   {Enter}')
  expect(create().disabled).toBe(true)
  expect(onCreate).not.toHaveBeenCalled()
})

test('creates with the trimmed name and the colour by its index', async () => {
  const { onCreate } = setup({ initialColorIndex: 2 })
  await userEvent.type(name(), ' Olivia ')
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledWith('Olivia', 2)
})

test('another colour goes with it', async () => {
  const { onCreate } = setup({ initialName: 'Olivia', initialColorIndex: 0 })
  await userEvent.click(screen.getByRole('radio', { name: 'Tangerine' }))
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledWith('Olivia', 3)
})

test('Enter creates', async () => {
  const { onCreate } = setup({ initialName: 'Olivia' })
  await userEvent.keyboard('{Enter}')
  expect(onCreate).toHaveBeenCalledOnce()
})

test('a repeated name is allowed and said out loud', async () => {
  const { onCreate } = setup({ initialName: 'Mark Ellis', isNameTaken: (value: string) => value === 'Mark Ellis' })
  expect(screen.getByText('Another speaker is also named "Mark Ellis".')).toBeTruthy()
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledOnce()
})

test('a failure shows in the window, which stays, and typing clears it', async () => {
  const onCreate = vi.fn(async () => { throw new Error('Server error 500') })
  setup({ initialName: 'Olivia', onCreate })
  await userEvent.click(create())
  expect(await screen.findByText('Server error 500')).toBeTruthy()
  expect(create().disabled).toBe(false)
  await userEvent.type(name(), 'x')
  expect(screen.queryByText('Server error 500')).toBeNull()
})

test('Back goes back, it does not close', async () => {
  const { onBack, onClose } = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(onBack).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
})

const handle = () => screen.getByRole('textbox', { name: 'Handle' }) as HTMLInputElement

test('Handle is in sight and works; there is no Email', () => {
  setup()
  expect(screen.queryByRole('button', { name: 'Optional details' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
  expect(handle().getAttribute('aria-disabled')).toBeNull()
  expect(handle().getAttribute('data-not-implemented')).toBeNull()
})

test('shows the handle the name brings, which is not sent: the backend makes it', async () => {
  const onNameChange = vi.fn()
  const { onCreate } = setup({ initialName: 'Olivia Brown', suggestedHandle: 'olivia.brown2', onNameChange })
  expect(handle().value).toBe('olivia.brown2')
  await userEvent.type(name(), 'e')
  expect(onNameChange).toHaveBeenLastCalledWith('Olivia Browne')
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledWith('Olivia Browne', 0)
})

test('no name, no handle: the field shows an example', () => {
  setup({ suggestedHandle: 'stale' })
  expect(handle().value).toBe('')
  expect(handle().placeholder).toBe('olivia.brown')
})

test('a handle typed goes with the speaker, lowercase and without the @', async () => {
  const { onCreate } = setup({ initialName: 'Olivia Brown', suggestedHandle: 'olivia.brown' })
  await userEvent.clear(handle())
  await userEvent.type(handle(), '@Liv')
  expect(handle().value).toBe('liv')
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledWith('Olivia Brown', 0, 'liv')
})

test('an emptied handle shows the one from the name and sends none', async () => {
  const { onCreate } = setup({ initialName: 'Olivia Brown', suggestedHandle: 'olivia.brown' })
  await userEvent.clear(handle())
  expect(handle().placeholder).toBe('olivia.brown')
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledWith('Olivia Brown', 0)
})

test('a handle that cannot be had is said, and Create waits', async () => {
  const checkHandle = (value: string) => (value === 'mark.ellis' ? '@mark.ellis is taken by Mark Ellis.' : undefined)
  const { onCreate } = setup({ initialName: 'Mark Ellis', suggestedHandle: 'mark.ellis2', checkHandle })
  await userEvent.clear(handle())
  await userEvent.type(handle(), 'mark.ellis{Enter}')
  expect(screen.getByText('@mark.ellis is taken by Mark Ellis.')).toBeTruthy()
  expect(create().disabled).toBe(true)
  expect(onCreate).not.toHaveBeenCalled()
})

test('a refused handle shows under the handle, not the name', async () => {
  const onCreate = vi.fn(async () => { throw Object.assign(new Error('@liv is taken by Olivia.'), { code: 'handle_taken' }) })
  setup({ initialName: 'Olivia', onCreate })
  await userEvent.type(handle(), 'liv')
  await userEvent.click(create())
  expect(await screen.findByText('@liv is taken by Olivia.')).toBeTruthy()
  expect(handle().getAttribute('aria-invalid')).toBe('true')
  expect(name().getAttribute('aria-invalid')).toBeNull()
})

test('offers the colours the API keeps: not Gray, which means an unknown speaker', async () => {
  const { onCreate } = setup({ initialName: 'Zoe' })
  expect(screen.queryByRole('radio', { name: 'Gray' })).toBeNull()
  const radios = screen.getAllByRole('radio')
  expect(radios).toHaveLength(5)
  await userEvent.click(radios[4])
  await userEvent.click(create())
  expect(onCreate).toHaveBeenCalledWith('Zoe', 4)
})
