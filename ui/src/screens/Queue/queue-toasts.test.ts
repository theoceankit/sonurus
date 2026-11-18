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

test('a recording that could not be saved, or lost a source, says so', () => {
  expect(queueEventToast({ type: 'recording_failed', title: 'Standup', error: 'No audio was captured from the microphone.' }, () => {}))
    .toEqual({ message: 'Recording error: No audio was captured from the microphone.', type: 'error' })
  expect(queueEventToast({ type: 'recording_source_lost', source: 'mic', title: 'Standup' }, () => {})?.message)
    .toBe('The microphone was disconnected. The recording was stopped and saved.')
  expect(queueEventToast({ type: 'recording_source_lost', source: 'system', title: 'Standup' }, () => {})?.message)
    .toBe('System audio was lost. The recording was stopped and saved.')
})

test('a recording whose system audio held nothing says where macOS allows it, as a hint', () => {
  const toast = queueEventToast({ type: 'recording_system_silent', title: 'Standup' }, () => {})
  expect(toast?.message).toBe(
    'No system audio was heard in "Standup". If something played, allow Sonorus in System Settings → '
    + 'Privacy & Security → Screen & System Audio Recording.',
  )
  expect(toast?.type).toBeUndefined()
  expect(toast?.duration).toBeGreaterThan(6000)
})
