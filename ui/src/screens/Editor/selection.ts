import { canStep, currentStep, emptyHistory, fill, forget, historyOf, step, visit, type History } from './history'

// What the centre of the editor shows: a recording, a job of the queue over it, or
// nothing, and the way back and forward through what it showed. Every change goes
// through selectionReducer, so each way in or out of a recording is one action.
export interface Selection {
  // The recording open, shown when no job is.
  recordingId: number | null
  // A job picked in the queue takes the centre; the recording comes back when it goes.
  jobId: string | null
  // The user closed the recording: none opens by itself until they open one. A job
  // shown since goes back to nothing.
  closed: boolean
  // The recordings opened, and nothing open after a close, for Back and Forward.
  history: History
}

export type SelectionAction =
  // The user opened it: a click in the sidebar, Open on a toast, the Speakers window.
  | { type: 'open'; id: number }
  // The app opened it by itself, with nothing open: at startup, after a delete.
  | { type: 'pick'; id: number }
  | { type: 'showJob'; id: string }
  | { type: 'jobGone' }
  // The recording was deleted, here or elsewhere.
  | { type: 'gone'; id: number }
  | { type: 'close' }
  // Through the history. A job of the queue is not in it: Back takes it away.
  | { type: 'back' }
  | { type: 'forward' }

export const initialSelection = (recordingId: number | null = null): Selection =>
  ({ recordingId, jobId: null, closed: false, history: recordingId === null ? emptyHistory : historyOf(recordingId) })

// Onto a step of the history, as a click in the sidebar would open it.
function moved(state: Selection, history: History): Selection {
  if (history === state.history) return state
  const recordingId = currentStep(history) ?? null
  return { recordingId, jobId: null, closed: recordingId === null, history }
}

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'open':
      return { recordingId: action.id, jobId: null, closed: false, history: visit(state.history, action.id) }
    case 'pick':
      return state.recordingId !== null || state.closed ? state : { ...state, recordingId: action.id, history: fill(state.history, action.id) }
    case 'showJob':
      return { ...state, jobId: action.id }
    case 'jobGone':
      return state.jobId === null ? state : { ...state, jobId: null }
    case 'gone': {
      const history = forget(state.history, action.id)
      if (state.recordingId === action.id) return { ...state, recordingId: null, history }
      return history === state.history ? state : { ...state, history }
    }
    case 'close':
      return state.recordingId === null && state.jobId === null
        ? state
        : { recordingId: null, jobId: null, closed: true, history: visit(state.history, null) }
    case 'back':
      return state.jobId !== null ? { ...state, jobId: null } : moved(state, step(state.history, -1))
    case 'forward':
      return moved(state, step(state.history, 1))
  }
}

export const canGoBack = (state: Selection) => state.jobId !== null || canStep(state.history, -1)
export const canGoForward = (state: Selection) => canStep(state.history, 1)

// The recording whose transcript, inspector and player are on the screen.
export const shownRecording = (state: Selection) => (state.jobId === null ? state.recordingId : null)

// Whether the app may pick a recording by itself.
export const needsPick = (state: Selection) => state.recordingId === null && !state.closed
