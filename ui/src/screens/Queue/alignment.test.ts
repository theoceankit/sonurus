import { expect, test } from 'vitest'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import { addLanguage, alignmentRetryJobs, alignmentState, retryLabel } from './alignment'

test('the state: downloading first, then ready, then a failed download, else the offer', () => {
  expect(alignmentState({ downloading: true, installed: true, failed: true })).toBe('downloading')
  expect(alignmentState({ downloading: false, installed: true, failed: true })).toBe('ready')
  expect(alignmentState({ downloading: false, installed: false, failed: true })).toBe('failed')
  expect(alignmentState({ downloading: false, installed: false, failed: false })).toBe('offer')
})

test('retry label and the jobs it retries, in queue order', () => {
  expect(retryLabel(1)).toBe('Retry transcription')
  expect(retryLabel(3)).toBe('Retry 3 transcriptions')
  const failed = (id: string, language: string, code = 'alignment_model_missing') => ({
    ...QUEUE_JOB, id, status: 'failed' as const, language, error: 'x', error_code: code, error_language: language,
  })
  const snapshot = queueSnapshot({ jobs: [failed('a', 'ru'), failed('b', 'pt'), failed('c', 'ru', 'whisper_model_missing'), { ...QUEUE_JOB, id: 'd' }, failed('e', 'ru')] })
  expect(alignmentRetryJobs('ru', snapshot).map(job => job.id)).toEqual(['a', 'e'])
  expect(alignmentRetryJobs('ru', undefined)).toEqual([])
})

test('a language waiting is not added again', () => {
  expect(addLanguage(['ru'], 'ru')).toEqual(['ru'])
  expect(addLanguage(['ru'], 'pt')).toEqual(['ru', 'pt'])
})
