// The recordings the user went through, for Back and Forward, as in a browser. A
// step is a recording, or null for nothing open after the user closed it. Kept in
// memory only, so each run starts afresh.

export type Step = number | null

// Where the open recording was deleted: the app's pick fills it, a move leaves it.
const GONE = 'gone'
type Slot = Step | typeof GONE

export interface History {
  readonly steps: readonly Slot[]
  // The step on the screen; -1 before the first.
  readonly at: number
}

export const HISTORY_LIMIT = 100

export const emptyHistory: History = { steps: [], at: -1 }

export const historyOf = (step: Step): History => ({ steps: [step], at: 0 })

const holeAt = (history: History) => history.at >= 0 && history.steps[history.at] === GONE

// The history without the hole of a deleted recording; a move from it lands where
// the steps on either side now meet.
function withoutHole(history: History): History {
  if (!holeAt(history)) return history
  const steps = history.steps.filter((_, index) => index !== history.at)
  return { steps, at: history.at - 1 }
}

// Neighbours that came to be the same step are one, the current one among them.
function merged(steps: readonly Slot[], at: number): History {
  const kept: Slot[] = []
  let current = -1
  steps.forEach((step, index) => {
    if (!(kept.length > 0 && step !== GONE && kept[kept.length - 1] === step)) kept.push(step)
    if (index === at) current = kept.length - 1
  })
  return { steps: kept, at: current }
}

// The user opened a recording or closed one. The steps after the current one go, as
// in a browser; the same step again adds none.
export function visit(history: History, step: Step): History {
  const from = withoutHole(history)
  if (from.at >= 0 && from.steps[from.at] === step) return from
  const steps = [...from.steps.slice(0, from.at + 1), step]
  const over = Math.max(0, steps.length - HISTORY_LIMIT)
  return { steps: steps.slice(over), at: steps.length - 1 - over }
}

// The app opened a recording by itself: the first step at startup, or the one in
// place of the open recording that was deleted. Never a step of its own.
export function fill(history: History, id: number): History {
  if (history.at < 0) return historyOf(id)
  if (!holeAt(history)) return history
  const steps = history.steps.map((step, index) => (index === history.at ? id : step))
  return merged(steps, history.at)
}

export function canStep(history: History, by: -1 | 1): boolean {
  if (holeAt(history)) return by < 0 ? history.at > 0 : history.at < history.steps.length - 1
  const to = history.at + by
  return history.at >= 0 && to >= 0 && to < history.steps.length
}

// Back (-1) or Forward (1). Unchanged when there is nowhere to go.
export function step(history: History, by: -1 | 1): History {
  if (!canStep(history, by)) return history
  if (holeAt(history)) {
    const from = withoutHole(history)
    return { ...from, at: by < 0 ? from.at : from.at + 1 }
  }
  return { ...history, at: history.at + by }
}

// The step on the screen. Undefined before the first and on the hole of a deleted one.
export function currentStep(history: History): Step | undefined {
  const slot = history.steps[history.at]
  return slot === GONE ? undefined : slot
}

// A recording deleted, here or elsewhere, leaves the history. In place of the open
// one stays a hole for the app's pick.
export function forget(history: History, id: number): History {
  if (!history.steps.includes(id)) return history
  const steps: Slot[] = []
  let at = -1
  history.steps.forEach((slot, index) => {
    if (index === history.at) {
      steps.push(slot === id ? GONE : slot)
      at = steps.length - 1
    } else if (slot !== id) {
      steps.push(slot)
    }
  })
  return merged(steps, at)
}
