// What the centre of the editor shows: a recording, a job of the queue over it, or
// nothing. Every change goes through selectionReducer, so each way in or out of a
// recording is one action.
export interface Selection {
  // The recording open, shown when no job is.
  recordingId: number | null
  // A job picked in the queue takes the centre; the recording comes back when it goes.
  jobId: string | null
  // The user closed the recording: none opens by itself until they open one. A job
  // shown since goes back to nothing.
  closed: boolean
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

export const initialSelection = (recordingId: number | null = null): Selection => ({ recordingId, jobId: null, closed: false })

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'open':
      return { recordingId: action.id, jobId: null, closed: false }
    case 'pick':
      return state.recordingId !== null || state.closed ? state : { ...state, recordingId: action.id }
    case 'showJob':
      return { ...state, jobId: action.id }
    case 'jobGone':
      return state.jobId === null ? state : { ...state, jobId: null }
    case 'gone':
      return state.recordingId === action.id ? { ...state, recordingId: null } : state
    case 'close':
      return state.recordingId === null && state.jobId === null ? state : { recordingId: null, jobId: null, closed: true }
  }
}

// The recording whose transcript, inspector and player are on the screen.
export const shownRecording = (state: Selection) => (state.jobId === null ? state.recordingId : null)

// Whether the app may pick a recording by itself.
export const needsPick = (state: Selection) => state.recordingId === null && !state.closed
