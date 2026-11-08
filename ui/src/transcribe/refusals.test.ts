import { expect, test } from 'vitest'
import { ApiError } from '../api/client'
import type { RefusalCode } from '../api/types'
import { refusalOf } from './refusals'

test('a refusal says what is wrong, and a missing model leads to its section of Settings', () => {
  const refusal = (code: RefusalCode | null, message = 'Any wording') => new ApiError(400, message, code)
  expect(refusalOf(refusal('diarization_model_missing', 'Diarization model is not installed.'))).toEqual({
    message: 'Diarization model is not installed.', code: 'diarization_model_missing', settingsSection: 'models',
  })
  expect(refusalOf(refusal('whisper_model_missing')).settingsSection).toBe('models')
  expect(refusalOf(refusal('alignment_model_missing')).settingsSection).toBe('alignment')
  // The wording does not matter, only the code.
  expect(refusalOf(refusal('audio_not_readable', 'Model not installed')).settingsSection).toBeNull()
  expect(refusalOf(refusal(null, 'Whisper model is not installed')).settingsSection).toBeNull()
  expect(refusalOf(new ApiError(0, 'Failed to fetch'))).toEqual({ message: 'The backend is not responding.', code: null, settingsSection: null })
})

test('the running job is refused with its own code and no way to Settings', () => {
  expect(refusalOf(new ApiError(409, 'This job has started and can no longer be changed.', 'job_running'))).toEqual({
    message: 'This job has started and can no longer be changed.', code: 'job_running', settingsSection: null,
  })
})
