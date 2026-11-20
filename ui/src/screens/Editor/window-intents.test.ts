import { expect, test } from 'vitest'
import { QUEUE_JOB, queueSnapshot, TRANSCRIPTS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import type { QueueJob } from '../../api/types'
import { intentTarget } from './window-intents'

const failed = (id: string, changes: Partial<QueueJob> = {}): QueueJob => ({ ...QUEUE_JOB, id, status: 'failed', error: 'x', ...changes })
const known = { transcripts: TRANSCRIPTS, transcriptsFetching: false, queue: queueSnapshot({ jobs: [failed('j1')] }) }

test('a recording in the list opens; one missing is gone once the list is loaded and settled', () => {
  expect(intentTarget({ open: 'recording', transcriptId: WEEKLY_SYNC_ID }, known)).toBe('open')
  expect(intentTarget({ open: 'recording', transcriptId: 999 }, known)).toBe('gone')
  expect(intentTarget({ open: 'recording', transcriptId: 999 }, { ...known, transcripts: undefined })).toBe('wait')
  expect(intentTarget({ open: 'recording', transcriptId: 999 }, { ...known, transcriptsFetching: true })).toBe('wait')
})

test('a job in the queue opens, one not there is gone, and an unknown queue waits', () => {
  expect(intentTarget({ open: 'job', jobId: 'j1' }, known)).toBe('open')
  expect(intentTarget({ open: 'job', jobId: 'j2' }, known)).toBe('gone')
  expect(intentTarget({ open: 'job', jobId: 'j1' }, { ...known, queue: undefined })).toBe('wait')
})

test('the Alignment model dialog opens while a job still waits for that model', () => {
  const waiting = { ...known, queue: queueSnapshot({ jobs: [failed('a', { error_code: 'alignment_model_missing', error_language: 'cs' })] }) }
  expect(intentTarget({ open: 'alignment-model', language: 'cs' }, waiting)).toBe('open')
  expect(intentTarget({ open: 'alignment-model', language: 'pt' }, waiting)).toBe('gone')
  expect(intentTarget({ open: 'alignment-model', language: 'cs' }, { ...known, queue: undefined })).toBe('wait')
})

test('the dialogs of a call open at once', () => {
  expect(intentTarget({ dialog: 'stop-recording' }, { ...known, transcripts: undefined, queue: undefined })).toBe('open')
})
