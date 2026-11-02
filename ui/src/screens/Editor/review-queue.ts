// Who the review is on. Who still needs one comes from the data each time, so an
// assignment, an undo or a change in the transcript all move the review the same way.
export interface ReviewState {
  // As at opening: "1 of 4" counts these even once some are done.
  order: readonly string[]
  currentId: string | null
  closed: boolean
}

export interface ReviewView {
  currentId: string | null
  position: number
  total: number
  left: number
  mode: 'on' | 'collapsed' | 'off'
}

export const openReview = (pending: readonly string[], currentId: string | null = pending[0] ?? null): ReviewState => (
  { order: pending, currentId, closed: false }
)

const fullOrder = (state: ReviewState, pending: readonly string[]) => [
  ...state.order,
  ...pending.filter(id => !state.order.includes(id)),
]

// The first one waiting after this place, going around, itself last.
function nextWaiting(order: readonly string[], from: string | null, pending: readonly string[]): string | null {
  const start = from === null ? -1 : order.indexOf(from)
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length]
    if (pending.includes(id)) return id
  }
  return null
}

export function reviewView(state: ReviewState, pending: readonly string[]): ReviewView {
  const order = fullOrder(state, pending)
  const left = pending.length
  if (left === 0) return { currentId: null, position: 0, total: order.length, left, mode: 'off' }
  const currentId = state.currentId !== null && pending.includes(state.currentId)
    ? state.currentId
    : nextWaiting(order, state.currentId, pending)
  return {
    currentId,
    position: order.indexOf(currentId!) + 1,
    total: order.length,
    left,
    mode: state.closed ? 'collapsed' : 'on',
  }
}

const moveOn = (state: ReviewState, pending: readonly string[]) => {
  const { currentId } = reviewView(state, pending)
  return nextWaiting(fullOrder(state, pending), currentId, pending)
}

export const skipSpeaker = (state: ReviewState, pending: readonly string[]): ReviewState => (
  { ...state, currentId: moveOn(state, pending) }
)

export const closeReview = (state: ReviewState): ReviewState => ({ ...state, closed: true })

export const resumeReview = (state: ReviewState, pending: readonly string[]): ReviewState => (
  { ...state, currentId: moveOn(state, pending), closed: false }
)

// A click on a speaker, and an undo: the card opens on them.
export const selectSpeaker = (state: ReviewState, id: string): ReviewState => ({ ...state, currentId: id, closed: false })
