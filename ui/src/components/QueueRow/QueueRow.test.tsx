import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { QueueRow } from './QueueRow'

test('the running job turns and a failed one has a dot; a waiting one has nothing', () => {
  const { rerender } = render(<QueueRow title="A" status="running" />)
  screen.getByRole('img', { name: 'Transcribing' })
  rerender(<QueueRow title="A" status="failed" />)
  screen.getByRole('img', { name: 'Failed' })
  rerender(<QueueRow title="A" status="waiting" />)
  expect(screen.queryByRole('img')).toBeNull()
})

test('a click on the row selects it; its own buttons act apart', async () => {
  const onClick = vi.fn()
  const onRetry = vi.fn()
  render(<QueueRow title="Weekly sync" status="failed" selected onClick={onClick} actions={<button type="button" onClick={onRetry}>Retry</button>} />)
  const row = screen.getByRole('button', { name: /Weekly sync/ })
  expect(row.getAttribute('aria-current')).toBe('true')
  await userEvent.click(row)
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onClick).toHaveBeenCalledOnce()
  expect(onRetry).toHaveBeenCalledOnce()
})
