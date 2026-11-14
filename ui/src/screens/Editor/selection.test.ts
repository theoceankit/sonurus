import { describe, expect, test } from 'vitest'
import { initialSelection, needsPick, selectionReducer, shownRecording, type Selection, type SelectionAction } from './selection'

const run = (state: Selection, ...actions: SelectionAction[]) => actions.reduce(selectionReducer, state)
const open = (id: number): SelectionAction => ({ type: 'open', id })
const pick = (id: number): SelectionAction => ({ type: 'pick', id })
const showJob = (id: string): SelectionAction => ({ type: 'showJob', id })
const gone = (id: number): SelectionAction => ({ type: 'gone', id })
const jobGone: SelectionAction = { type: 'jobGone' }
const close: SelectionAction = { type: 'close' }

describe('opening', () => {
  test('starts with nothing open, waiting for a pick', () => {
    const state = initialSelection()
    expect(state).toEqual({ recordingId: null, jobId: null, closed: false })
    expect(needsPick(state)).toBe(true)
  })

  test('a story may start with a recording open', () => {
    expect(initialSelection(7).recordingId).toBe(7)
  })

  test('a pick opens a recording only when none is open', () => {
    expect(run(initialSelection(), pick(3)).recordingId).toBe(3)
    expect(run(initialSelection(1), pick(3)).recordingId).toBe(1)
  })

  test('opening a recording takes the centre from a job', () => {
    const state = run(initialSelection(1), showJob('j'), open(2))
    expect(state).toEqual({ recordingId: 2, jobId: null, closed: false })
    expect(shownRecording(state)).toBe(2)
  })
})

describe('a job of the queue', () => {
  test('takes the centre and gives the recording back when it goes', () => {
    const withJob = run(initialSelection(1), showJob('j'))
    expect(shownRecording(withJob)).toBeNull()
    expect(withJob.recordingId).toBe(1)
    expect(shownRecording(run(withJob, jobGone))).toBe(1)
  })

  test('going when none is shown changes nothing', () => {
    const state = initialSelection(1)
    expect(selectionReducer(state, jobGone)).toBe(state)
  })
})

describe('a recording deleted', () => {
  test('the open one lets go, and the app may pick another', () => {
    const state = run(initialSelection(1), gone(1))
    expect(state.recordingId).toBeNull()
    expect(needsPick(state)).toBe(true)
  })

  test('another one leaves the open one open', () => {
    const state = initialSelection(1)
    expect(selectionReducer(state, gone(2))).toBe(state)
  })
})

describe('closing', () => {
  test('leaves nothing in the centre, and nothing is picked', () => {
    const state = run(initialSelection(1), close)
    expect(state).toEqual({ recordingId: null, jobId: null, closed: true })
    expect(shownRecording(state)).toBeNull()
    expect(needsPick(state)).toBe(false)
    expect(run(state, pick(2))).toBe(state)
  })

  test('closes a job and the recording under it', () => {
    expect(run(initialSelection(1), showJob('j'), close)).toEqual({ recordingId: null, jobId: null, closed: true })
  })

  test('with nothing open changes nothing', () => {
    const state = initialSelection()
    expect(selectionReducer(state, close)).toBe(state)
  })

  test('a delete or a job gone afterwards opens nothing', () => {
    const closed = run(initialSelection(1), close)
    expect(run(closed, gone(1), gone(2), jobGone)).toBe(closed)
  })

  test('the user opens a recording or a job again', () => {
    const closed = run(initialSelection(1), close)
    expect(run(closed, open(2))).toEqual({ recordingId: 2, jobId: null, closed: false })
  })

  test('a job shown afterwards goes back to nothing', () => {
    const job = run(initialSelection(1), close, showJob('j'))
    expect(job.jobId).toBe('j')
    const after = run(job, jobGone)
    expect(after).toEqual({ recordingId: null, jobId: null, closed: true })
    expect(needsPick(after)).toBe(false)
  })
})
