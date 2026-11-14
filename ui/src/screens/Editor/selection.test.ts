import { describe, expect, test } from 'vitest'
import { currentStep } from './history'
import { canGoBack, canGoForward, initialSelection, needsPick, selectionReducer, shownRecording, type Selection, type SelectionAction } from './selection'

const run = (state: Selection, ...actions: SelectionAction[]) => actions.reduce(selectionReducer, state)
const open = (id: number): SelectionAction => ({ type: 'open', id })
const pick = (id: number): SelectionAction => ({ type: 'pick', id })
const showJob = (id: string): SelectionAction => ({ type: 'showJob', id })
const gone = (id: number): SelectionAction => ({ type: 'gone', id })
const jobGone: SelectionAction = { type: 'jobGone' }
const close: SelectionAction = { type: 'close' }
const back: SelectionAction = { type: 'back' }
const forward: SelectionAction = { type: 'forward' }
// What the centre shows, without the history.
const centre = ({ recordingId, jobId, closed }: Selection) => ({ recordingId, jobId, closed })

describe('opening', () => {
  test('starts with nothing open, waiting for a pick', () => {
    const state = initialSelection()
    expect(centre(state)).toEqual({ recordingId: null, jobId: null, closed: false })
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
    expect(centre(state)).toEqual({ recordingId: 2, jobId: null, closed: false })
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
    expect(centre(state)).toEqual({ recordingId: null, jobId: null, closed: true })
    expect(shownRecording(state)).toBeNull()
    expect(needsPick(state)).toBe(false)
    expect(run(state, pick(2))).toBe(state)
  })

  test('closes a job and the recording under it', () => {
    expect(centre(run(initialSelection(1), showJob('j'), close))).toEqual({ recordingId: null, jobId: null, closed: true })
  })

  test('with nothing open changes nothing', () => {
    const state = initialSelection()
    expect(selectionReducer(state, close)).toBe(state)
  })

  test('a delete or a job gone afterwards opens nothing', () => {
    const closed = run(initialSelection(1), close)
    const after = run(closed, gone(1), gone(2), jobGone)
    expect(centre(after)).toEqual(centre(closed))
    expect(needsPick(after)).toBe(false)
  })

  test('the user opens a recording or a job again', () => {
    const closed = run(initialSelection(1), close)
    expect(centre(run(closed, open(2)))).toEqual({ recordingId: 2, jobId: null, closed: false })
  })

  test('a job shown afterwards goes back to nothing', () => {
    const job = run(initialSelection(1), close, showJob('j'))
    expect(job.jobId).toBe('j')
    const after = run(job, jobGone)
    expect(centre(after)).toEqual({ recordingId: null, jobId: null, closed: true })
    expect(needsPick(after)).toBe(false)
  })
})

describe('Back and Forward', () => {
  test('go through the recordings opened, the first pick of the app the first step', () => {
    const state = run(initialSelection(), pick(1), open(2), open(3))
    expect(canGoForward(state)).toBe(false)
    expect(run(state, back).recordingId).toBe(2)
    expect(run(state, back, back).recordingId).toBe(1)
    expect(canGoBack(run(state, back, back))).toBe(false)
    expect(run(state, back, back, forward).recordingId).toBe(2)
  })

  test('with nowhere to go change nothing', () => {
    const state = initialSelection(1)
    expect(canGoBack(state)).toBe(false)
    expect(canGoForward(state)).toBe(false)
    expect(selectionReducer(state, back)).toBe(state)
    expect(selectionReducer(state, forward)).toBe(state)
  })

  test('Back after a close opens the closed recording, Forward closes it again', () => {
    const closed = run(initialSelection(1), open(2), close)
    expect(centre(run(closed, back))).toEqual({ recordingId: 2, jobId: null, closed: false })
    expect(centre(run(closed, back, forward))).toEqual({ recordingId: null, jobId: null, closed: true })
  })

  test('Back to nothing open picks nothing', () => {
    const state = run(initialSelection(1), close, open(2), back)
    expect(centre(state)).toEqual({ recordingId: null, jobId: null, closed: true })
    expect(needsPick(state)).toBe(false)
  })

  test('a job of the queue is not a step: Back takes it away, Forward goes on from under it', () => {
    const withJob = run(initialSelection(1), open(2), back, showJob('j'))
    expect(canGoBack(withJob)).toBe(true)
    expect(centre(run(withJob, back))).toEqual({ recordingId: 1, jobId: null, closed: false })
    expect(centre(run(withJob, forward))).toEqual({ recordingId: 2, jobId: null, closed: false })
    expect(run(withJob, back).history).toBe(withJob.history)
  })

  test('a job shown and gone leaves the history as it was', () => {
    const state = run(initialSelection(1), open(2))
    expect(run(state, showJob('j'), jobGone).history).toBe(state.history)
  })

  test('a recording deleted is skipped', () => {
    const state = run(initialSelection(1), open(2), open(3), gone(2))
    expect(run(state, back).recordingId).toBe(1)
  })

  test('the pick after the open one is deleted takes its place, with no step of its own', () => {
    const state = run(initialSelection(1), open(2), open(3), gone(3), pick(4))
    expect(state.recordingId).toBe(4)
    expect(canGoForward(state)).toBe(false)
    expect(run(state, back).recordingId).toBe(2)
  })

  test('the same recording opened again is no step', () => {
    const state = run(initialSelection(1), open(2))
    expect(run(state, open(2)).history).toBe(state.history)
    expect(currentStep(state.history)).toBe(2)
  })
})
