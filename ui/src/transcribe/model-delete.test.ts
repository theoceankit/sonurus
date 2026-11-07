import { expect, test } from 'vitest'
import { QUEUE_JOB, queueSnapshot } from '../api/fixtures/data'
import { fixtureModels } from '../api/fixtures/models'
import type { QueueJob } from '../api/types'
import { modelDeletePrompt, modelInUseByRunningJob, queuedJobsUsingModel } from './model-delete'

const model = (id: string) => fixtureModels([id]).find(m => m.id === id)!
const job = (id: string, change: Partial<QueueJob>): QueueJob => ({ ...QUEUE_JOB, id, ...change })

const queue = queueSnapshot({
  jobs: [
    job('a', { status: 'waiting', whisper_model: 'small', language: 'ru' }),
    job('b', { status: 'failed', whisper_model: 'small', language: null }),
    job('c', { status: 'waiting', whisper_model: 'large-v3', language: 'ru' }),
    job('e', { status: 'running', whisper_model: 'tiny', language: 'cs' }),
  ],
  running_job_id: 'e',
})

test('queuedJobsUsingModel: waiting and failed jobs of that Whisper model; every job for diarization; by language for alignment', () => {
  expect(queuedJobsUsingModel(model('small'), queue)).toBe(2)
  expect(queuedJobsUsingModel(model('large-v3'), queue)).toBe(1)
  expect(queuedJobsUsingModel(model('medium'), queue)).toBe(0)
  expect(queuedJobsUsingModel(model('diarize'), queue)).toBe(3)
  expect(queuedJobsUsingModel(model('ru'), queue)).toBe(2)
  expect(queuedJobsUsingModel(model('small'), undefined)).toBe(0)
})

test('modelInUseByRunningJob: its Whisper model, the diarization model and its alignment model', () => {
  expect(modelInUseByRunningJob(model('tiny'), queue)).toBe(true)
  expect(modelInUseByRunningJob(model('diarize'), queue)).toBe(true)
  expect(modelInUseByRunningJob(model('cs'), queue)).toBe(true)
  expect(modelInUseByRunningJob(model('small'), queue)).toBe(false)
  expect(modelInUseByRunningJob(model('tiny'), { ...queue, running_job_id: null })).toBe(false)
})

test('modelDeletePrompt: one job, several jobs; none without queued jobs', () => {
  expect(modelDeletePrompt('Whisper Small', 1)).toEqual({ title: 'Delete Whisper Small?', body: '1 job in the queue uses Whisper Small. Delete anyway?' })
  expect(modelDeletePrompt('Whisper Small', 3)?.body).toBe('3 jobs in the queue use Whisper Small. Delete anyway?')
  expect(modelDeletePrompt('Whisper Small', 0)).toBeNull()
})
