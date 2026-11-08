import { describe, expect, test } from 'vitest'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import type { QueueJob } from '../../api/types'
import { applyOrder, deleteJobPrompt, dropPlace, jobStatusText, moveJob, queueStateLabel, queueToggle, reorderJobIds } from './queue'

const job = (changes: Partial<QueueJob> = {}): QueueJob => ({
  ...QUEUE_JOB, id: 'j1', audio_path: '/data/recordings/sonorus-import-1.wav', title: 'Weekly sync', ...changes,
})

describe('header', () => {
  test('queueStateLabel: running, paused, paused by a recording', () => {
    expect(queueStateLabel(queueSnapshot())).toBe('Running')
    expect(queueStateLabel(queueSnapshot({ paused: true }))).toBe('Paused')
    expect(queueStateLabel(queueSnapshot({ paused: true, paused_by_recording: true, recording: true }))).toBe('Paused while recording')
  })

  test('queueToggle: Pause queue while running, Resume queue while paused (also during a recording)', () => {
    expect(queueToggle(queueSnapshot())).toEqual({ action: 'pause', label: 'Pause queue', icon: 'pause' })
    expect(queueToggle(queueSnapshot({ paused: true }))).toEqual({ action: 'start', label: 'Resume queue', icon: 'play' })
    expect(queueToggle(queueSnapshot({ paused: true, paused_by_recording: true, recording: true })).action).toBe('start')
  })
})

describe('job card', () => {
  test('the running job shows its step', () => {
    const running = job({ status: 'running' })
    expect(jobStatusText(running, queueSnapshot({ running_job_id: 'j1', step: 'Transcribing audio…' }))).toBe('Transcribing audio…')
    expect(jobStatusText(running, queueSnapshot({ running_job_id: 'j1' }))).toBe('Starting…')
  })

  test('waiting jobs: no place in the queue, and no separator dot', () => {
    expect(jobStatusText(job(), queueSnapshot({ jobs: [job()] }))).toBe('Waiting in the queue')
    expect(jobStatusText(job(), queueSnapshot({ paused: true, jobs: [job()] }))).toBe('Waiting, queue paused')
  })

  test('a failed job: the missing model, or else that it failed; the error itself is shown apart', () => {
    expect(jobStatusText(job({ status: 'failed', error: 'Failed to load audio: ffmpeg version n9\n  built with gcc' }), queueSnapshot())).toBe('Transcription failed')
  })

  test('a missing model is named; an alignment model by the name of its language', () => {
    const failed = (changes: Partial<QueueJob>) => jobStatusText(job({ status: 'failed', error: 'long text', ...changes }), queueSnapshot())
    expect(failed({ error_code: 'alignment_model_missing', error_language: 'pt' })).toBe('Alignment model for "Portuguese" is not installed')
    expect(failed({ error_code: 'alignment_model_missing', error_language: 'xx' })).toBe('Alignment model for "xx" is not installed')
    expect(failed({ error_code: 'whisper_model_missing', error: 'Whisper model "tiny" is not installed. Download it in Settings.' }))
      .toBe('Whisper model "tiny" is not installed')
    expect(failed({ error_code: 'whisper_model_missing' })).toBe('Whisper model is not installed')
    expect(failed({ error_code: 'diarization_model_missing' })).toBe('Diarization model is not installed')
  })

  test('deleteJobPrompt: an import keeps the original file', () => {
    const prompt = deleteJobPrompt(job())
    expect(prompt.title).toBe('Delete "Weekly sync"?')
    expect(prompt.body).toMatch(/original file is kept/)
  })

  test('deleteJobPrompt: a live recording is gone for good', () => {
    const prompt = deleteJobPrompt(job({ audio_path: '/data/recordings/sonorus-rec-1.webm', title: 'Call' }))
    expect(prompt.title).toBe('Delete "Call"?')
    expect(prompt.body).toMatch(/recording will be deleted/)
    expect(prompt.body).toMatch(/cannot be undone/)
  })
})

describe('order', () => {
  test('reorderJobIds: before / after the target', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(reorderJobIds(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
    expect(reorderJobIds(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderJobIds(ids, 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a'])
    expect(reorderJobIds(ids, 'c', 'a', 'before')).toEqual(['c', 'a', 'b', 'd'])
  })

  test('reorderJobIds: onto itself or an unknown id, the same order', () => {
    const ids = ['a', 'b', 'c']
    expect(reorderJobIds(ids, 'b', 'b', 'after')).toEqual(ids)
    expect(reorderJobIds(ids, 'x', 'b', 'after')).toEqual(ids)
    expect(reorderJobIds(ids, 'a', 'x', 'after')).toEqual(ids)
  })

  test('reorderJobIds: does not change the input', () => {
    const ids = ['a', 'b']
    reorderJobIds(ids, 'a', 'b', 'after')
    expect(ids).toEqual(['a', 'b'])
  })

  test('dropPlace: upper half before, lower half after', () => {
    expect(dropPlace({ top: 100, height: 40 }, 110)).toBe('before')
    expect(dropPlace({ top: 100, height: 40 }, 119)).toBe('before')
    expect(dropPlace({ top: 100, height: 40 }, 120)).toBe('after')
    expect(dropPlace({ top: 100, height: 40 }, 139)).toBe('after')
  })

  test('moveJob: a step up or down, not past the ends', () => {
    const ids = ['a', 'b', 'c']
    expect(moveJob(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveJob(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveJob(ids, 'a', -1)).toBeNull()
    expect(moveJob(ids, 'c', 1)).toBeNull()
    expect(moveJob(ids, 'x', 1)).toBeNull()
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('applyOrder', () => {
  const jobs = ['a', 'b', 'c'].map(id => job({ id }))
  const ids = (list: readonly QueueJob[]) => list.map(j => j.id)

  test('shows the jobs in the given order, with the snapshot\'s data', () => {
    const fresh = jobs.map(j => (j.id === 'b' ? { ...j, status: 'running' as const } : j))
    const shown = applyOrder(fresh, ['c', 'a', 'b'])
    expect(ids(shown)).toEqual(['c', 'a', 'b'])
    expect(shown[2].status).toBe('running')
  })

  test('a job gone since drops out; a new one comes last, in the snapshot\'s order', () => {
    const now = [...jobs.filter(j => j.id !== 'a'), job({ id: 'd' }), job({ id: 'e' })]
    expect(ids(applyOrder(now, ['c', 'a', 'b']))).toEqual(['c', 'b', 'd', 'e'])
  })

  test('without an order the jobs stay as they are', () => {
    expect(applyOrder(jobs, null)).toBe(jobs)
  })
})
