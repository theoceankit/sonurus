import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { RecordingPill } from './RecordingPill'

test('while live it shows the time and its menu stops the recording', async () => {
  const onStop = vi.fn()
  render(<OverlayProvider><RecordingPill phase="live" elapsed="12:34" onStop={onStop} /></OverlayProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Recording 12:34' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop recording' }))
  expect(onStop).toHaveBeenCalledOnce()
})

test('starting and stopping only show, without an ellipsis', () => {
  const { rerender } = render(<OverlayProvider><RecordingPill phase="starting" elapsed="0:00" onStop={() => {}} /></OverlayProvider>)
  expect((screen.getByRole('button', { name: 'Starting' }) as HTMLButtonElement).disabled).toBe(true)
  rerender(<OverlayProvider><RecordingPill phase="stopping" elapsed="12:34" onStop={() => {}} /></OverlayProvider>)
  expect(screen.getByRole('button', { name: 'Stopping' }).textContent).toBe('Stopping')
})
