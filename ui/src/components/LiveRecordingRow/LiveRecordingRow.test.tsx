import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { LiveRecordingRow } from './LiveRecordingRow'

test('while live: the title, the time and Stop', async () => {
  const onStop = vi.fn()
  render(<OverlayProvider><LiveRecordingRow title="Standup" phase="live" elapsed="0:42" onStop={onStop} /></OverlayProvider>)
  screen.getByRole('img', { name: 'Recording' })
  screen.getByText('Standup')
  screen.getByText('0:42')
  await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  expect(onStop).toHaveBeenCalledOnce()
})

test('starting and stopping say so in place of the time, without an ellipsis, and cannot be stopped', () => {
  const { rerender } = render(<OverlayProvider><LiveRecordingRow title="Standup" phase="starting" elapsed="0:00" onStop={() => {}} /></OverlayProvider>)
  screen.getByText('Starting')
  expect(screen.queryByRole('button')).toBeNull()
  rerender(<OverlayProvider><LiveRecordingRow title="Standup" phase="stopping" elapsed="0:42" onStop={() => {}} /></OverlayProvider>)
  screen.getByText('Stopping')
  expect(screen.queryByText('0:42')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})
