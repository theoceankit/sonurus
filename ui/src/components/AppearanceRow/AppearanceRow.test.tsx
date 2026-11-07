import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { AppearanceRow } from './AppearanceRow'

const row = (props: Partial<Parameters<typeof AppearanceRow>[0]> = {}) => {
  const onOpen = vi.fn()
  const onPlay = vi.fn()
  render(<OverlayProvider><AppearanceRow title="Weekly product sync" date="4 Oct 2026" onOpen={onOpen} onPlay={onPlay} {...props} /></OverlayProvider>)
  return { onOpen, onPlay }
}

test('opens the recording, and plays a sample from it', async () => {
  const { onOpen, onPlay } = row()
  await userEvent.click(screen.getByText('Weekly product sync'))
  expect(onOpen).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Play a sample from Weekly product sync' }))
  expect(onPlay).toHaveBeenCalled()
})

test('while it plays, the button pauses', () => {
  row({ playing: true })
  expect(screen.getByRole('button', { name: 'Pause a sample from Weekly product sync' })).toBeTruthy()
})

test('with the audio gone, Play is off from the start and says why', () => {
  const { onPlay } = row({ audioMissing: true })
  expect((screen.getByRole('button', { name: 'Audio unavailable' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByLabelText('Weekly product sync: audio unavailable').getAttribute('tabindex')).toBe('0')
  expect(onPlay).not.toHaveBeenCalled()
})

test('shows the title and the date, and no time', () => {
  row()
  expect(screen.getByText('Weekly product sync').closest('button')!.textContent).toBe('Weekly product sync4 Oct 2026')
})
