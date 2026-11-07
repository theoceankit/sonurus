import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { ModelRow, type ModelRowProps } from './ModelRow'

const setup = (props: Partial<ModelRowProps> = {}) => {
  const handlers = { onDownload: vi.fn(), onCancel: vi.fn(), onUse: vi.fn(), onDelete: vi.fn() }
  render(<OverlayProvider><ModelRow icon="whisper-model" name="Whisper Small" meta={['244 MB', 'Good']} state="available" {...handlers} {...props} /></OverlayProvider>)
  return handlers
}
const button = (name: string) => screen.queryByRole('button', { name })

test('not downloaded: Download, nothing else', async () => {
  const { onDownload } = setup()
  await userEvent.click(button('Download')!)
  expect(onDownload).toHaveBeenCalledOnce()
  expect(button('Use')).toBeNull()
  expect(button('Delete Whisper Small')).toBeNull()
})

test('downloading: the progress and Cancel', async () => {
  const { onCancel } = setup({ state: 'downloading', pct: 42.4 })
  expect(screen.getByRole('progressbar', { name: 'Downloading Whisper Small' }).getAttribute('aria-valuenow')).toBe('42')
  expect(screen.getByText('42%')).toBeTruthy()
  await userEvent.click(button('Cancel')!)
  expect(onCancel).toHaveBeenCalledOnce()
})

test('installed: Use and delete; a click on the row uses it too', async () => {
  const { onUse, onDelete } = setup({ state: 'installed' })
  await userEvent.click(button('Use')!)
  await userEvent.click(screen.getByText('244 MB'))
  expect(onUse).toHaveBeenCalledTimes(2)
  await userEvent.click(button('Delete Whisper Small')!)
  expect(onDelete).toHaveBeenCalledOnce()
  expect(onUse).toHaveBeenCalledTimes(2)
})

test('the default: no Use, and the row is not a button', async () => {
  const { onUse } = setup({ state: 'installed', selected: true })
  expect(button('Use')).toBeNull()
  await userEvent.click(screen.getByText('244 MB'))
  expect(onUse).not.toHaveBeenCalled()
})

test('a model that cannot be deleted now: the button is off and says why', () => {
  setup({ state: 'installed', deleteBlocked: 'In use by the running transcription' })
  expect(button('Delete Whisper Small')).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('Whisper Small cannot be deleted: In use by the running transcription')).toBeTruthy()
})

test('failed: the reason and Retry, which downloads again', async () => {
  const { onDownload } = setup({ state: 'failed', error: 'Connection to huggingface.co timed out' })
  expect(screen.getByRole('alert').textContent).toBe('Download failed: Connection to huggingface.co timed out')
  await userEvent.click(button('Retry')!)
  expect(onDownload).toHaveBeenCalledOnce()
})

test('the state is in the buttons, not in words next to them', () => {
  setup({ state: 'installed' })
  expect(screen.getByRole('group', { name: 'Whisper Small' }).textContent).not.toMatch(/Installed|Not downloaded|Downloading/)
})

test('the default says Default', () => {
  setup({ state: 'installed', selected: true })
  expect(screen.getByRole('group', { name: 'Whisper Small' }).textContent).toContain('Default')
  expect(button('Use')).toBeNull()
})
