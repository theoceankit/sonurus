import { expect, test } from 'vitest'
import { QUEUE_JOB } from '../../api/fixtures/data'
import type { QueueJob } from '../../api/types'
import { canEditJob, jobEditPatch, jobForm } from './job-settings'

const job = (changes: Partial<QueueJob> = {}): QueueJob => ({ ...QUEUE_JOB, title: 'Weekly sync', whisper_model: 'small', language: null, status: 'waiting', ...changes })
const form = (changes = {}) => ({ title: 'Weekly sync', model: 'small', language: 'auto', ...changes })

test('canEditJob: every job but the running one', () => {
  expect(canEditJob(job())).toBe(true)
  expect(canEditJob(job({ status: 'failed' }))).toBe(true)
  expect(canEditJob(job({ status: 'running' }))).toBe(false)
})

test('jobForm: a detected language is auto', () => {
  expect(jobForm(job())).toEqual(form())
  expect(jobForm(job({ language: 'ru' })).language).toBe('ru')
})

test('jobEditPatch: nothing changed, no patch', () => {
  expect(jobEditPatch(job(), form())).toEqual({ patch: null })
  expect(jobEditPatch(job(), form({ title: '  Weekly sync ' }))).toEqual({ patch: null })
})

test('jobEditPatch: only the changed fields, the title trimmed', () => {
  expect(jobEditPatch(job(), form({ title: ' Standup ', model: 'large-v3' }))).toEqual({ patch: { title: 'Standup', whisper_model: 'large-v3' } })
})

test('jobEditPatch: auto is null', () => {
  expect(jobEditPatch(job(), form({ language: 'ru' }))).toEqual({ patch: { language: 'ru' } })
  expect(jobEditPatch(job({ language: 'ru' }), form({ language: 'auto' }))).toEqual({ patch: { language: null } })
  expect(jobEditPatch(job({ language: 'ru' }), form({ language: 'ru' }))).toEqual({ patch: null })
})

test('jobEditPatch: a blank or too long title is an error', () => {
  expect(jobEditPatch(job(), form({ title: '   ' })).error).toMatch(/empty/i)
  expect(jobEditPatch(job(), form({ title: 'x'.repeat(201) })).error).toMatch(/200/)
  expect(jobEditPatch(job(), form({ title: 'x'.repeat(200) })).error).toBeUndefined()
})
