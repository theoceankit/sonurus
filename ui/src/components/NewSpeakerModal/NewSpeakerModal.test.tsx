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

test('Handle is in sight, and not there yet; there is no Email', async () => {
  setup()
  expect(screen.queryByRole('button', { name: 'Optional details' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
  const input = screen.getByRole('textbox', { name: 'Handle' })
  expect(input.getAttribute('aria-disabled')).toBe('true')
  await userEvent.click(input)
  expect((await screen.findAllByText('Not available yet')).length).toBeGreaterThan(0)
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
