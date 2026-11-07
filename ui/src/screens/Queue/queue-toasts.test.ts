import { expect, test, vi } from 'vitest'
import { queueSnapshot } from '../../api/fixtures/data'
import { queueEventToast } from './queue-toasts'

test('a finished job is ready, and Open opens its recording', () => {
  const open = vi.fn()
  const toast = queueEventToast({ type: 'job_done', job_id: 'j', title: 'Weekly sync', transcript_id: 18 }, open)
  expect(toast?.message).toBe('"Weekly sync" is ready')
  expect(toast?.type).toBeUndefined()
  toast?.action?.onClick()
  expect(open).toHaveBeenCalledWith(18)
})

test('a failed job is an error, unless the Alignment model dialog takes it', () => {
  const failed = (error_code: string | null) => queueEventToast({
    type: 'job_failed', job_id: 'j', title: 'Weekly sync', error: 'x', error_code, error_language: 'pt',
  }, () => {})
  expect(failed(null)).toEqual({ message: 'Transcription failed: "Weekly sync"', type: 'error' })
  expect(failed('diarization_model_missing')?.type).toBe('error')
  expect(failed('alignment_model_missing')).toBeNull()
})

test('snapshots say nothing', () => {
  expect(queueEventToast(queueSnapshot(), () => {})).toBeNull()
})
