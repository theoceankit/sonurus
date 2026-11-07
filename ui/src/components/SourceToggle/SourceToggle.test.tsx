import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { SourceToggle } from './SourceToggle'

const DEVICES = [{ value: 'd', label: 'Default microphone' }, { value: 'm', label: 'Maono' }]
const setup = (props: Partial<Parameters<typeof SourceToggle>[0]> = {}) => {
  const onToggle = vi.fn()
  const onDeviceChange = vi.fn()
  render(<OverlayProvider><SourceToggle icon="microphone" name="Microphone" on devices={DEVICES} device="d" onToggle={onToggle} onDeviceChange={onDeviceChange} {...props} /></OverlayProvider>)
  return { onToggle, onDeviceChange }
}

test('the button says whether the source records and turns it on and off', async () => {
  const { onToggle } = setup()
  const button = screen.getByRole('button', { name: 'Microphone' })
  expect(button.getAttribute('aria-pressed')).toBe('true')
  await userEvent.click(button)
  expect(onToggle).toHaveBeenCalledOnce()
})

test('the arrow lists the devices with the chosen one checked, and picks another', async () => {
  const { onDeviceChange } = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Microphone device' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Maono' }))
  expect(onDeviceChange).toHaveBeenCalledWith('m')
})

test('the tooltip names the device, or says the source is off', async () => {
  setup()
  await userEvent.hover(screen.getByRole('button', { name: 'Microphone' }))
  expect((await screen.findByRole('tooltip')).textContent).toBe('Default microphone. Click to turn off')
})

test('a source that cannot record stays off, does nothing and says why', async () => {
  const { onToggle } = setup({ unavailable: 'No system audio can be recorded on this computer', devices: [], device: null })
  const button = screen.getByRole('button', { name: 'Microphone' })
  expect(button.getAttribute('aria-pressed')).toBe('false')
  await userEvent.hover(button)
  expect((await screen.findByRole('tooltip')).textContent).toBe('No system audio can be recorded on this computer')
  await userEvent.click(button)
  expect(onToggle).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Microphone device' }) as HTMLButtonElement).disabled).toBe(true)
})

test('while disabled nothing changes', async () => {
  const { onToggle } = setup({ disabled: true })
  await userEvent.click(screen.getByRole('button', { name: 'Microphone' }))
  expect(onToggle).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Microphone device' }) as HTMLButtonElement).disabled).toBe(true)
})
