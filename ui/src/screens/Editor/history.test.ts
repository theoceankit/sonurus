import { describe, expect, test } from 'vitest'
import { canStep, currentStep, emptyHistory, fill, forget, HISTORY_LIMIT, historyOf, step, visit, type History, type Step } from './history'

const through = (...steps: Step[]) => steps.reduce<History>(visit, emptyHistory)
const back = (history: History) => step(history, -1)
const forward = (history: History) => step(history, 1)
// The steps as they read, the current one in brackets, the hole of a deleted one as _.
const read = (history: History) => history.steps.map((slot, index) => {
  const text = slot === 'gone' ? '_' : slot === null ? '-' : String(slot)
  return index === history.at ? `[${text}]` : text
}).join(' ')

describe('visiting', () => {
  test('each recording opened is a step, the last one current', () => {
    expect(read(through(1, 2, 3))).toBe('1 2 [3]')
  })

  test('the same recording again adds no step', () => {
    const history = through(1, 2)
    expect(visit(history, 2)).toBe(history)
  })

  test('opening one after going back drops the steps forward', () => {
    expect(read(visit(back(through(1, 2, 3)), 4))).toBe('1 2 [4]')
  })

  test('nothing open after a close is a step too', () => {
    expect(read(through(1, null))).toBe('1 [-]')
  })

  test(`keeps the last ${HISTORY_LIMIT} steps`, () => {
    const ids = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => index + 1)
    const history = through(...ids)
    expect(history.steps).toHaveLength(HISTORY_LIMIT)
    expect(history.steps[0]).toBe(6)
    expect(currentStep(history)).toBe(HISTORY_LIMIT + 5)
  })
})

describe('Back and Forward', () => {
  test('go through the steps as in a browser', () => {
    const history = through(1, 2, 3)
    expect(currentStep(back(history))).toBe(2)
    expect(currentStep(back(back(history)))).toBe(1)
    expect(currentStep(forward(back(back(history))))).toBe(2)
  })

  test('nowhere to go leaves the history as it is', () => {
    const history = through(1, 2)
    expect(forward(history)).toBe(history)
    const first = back(history)
    expect(back(first)).toBe(first)
    expect(canStep(history, 1)).toBe(false)
    expect(canStep(history, -1)).toBe(true)
    expect(canStep(back(history), -1)).toBe(false)
  })

  test('there is nowhere to go before the first step or with one only', () => {
    expect(canStep(emptyHistory, -1)).toBe(false)
    expect(canStep(emptyHistory, 1)).toBe(false)
    expect(canStep(historyOf(1), -1)).toBe(false)
    expect(currentStep(emptyHistory)).toBeUndefined()
  })
})

describe('the first step and the pick after a delete', () => {
  test('the app opening one at startup is the first step', () => {
    expect(read(fill(emptyHistory, 4))).toBe('[4]')
  })

  test('a pick with a recording on the screen adds nothing', () => {
    const history = through(1, 2)
    expect(fill(history, 3)).toBe(history)
  })

  test('takes the place of the open recording deleted', () => {
    expect(read(fill(forget(through(1, 2, 3), 3), 4))).toBe('1 2 [4]')
  })

  test('the same recording as next to it is one step with it', () => {
    expect(read(fill(forget(through(1, 2), 2), 1))).toBe('[1]')
  })
})

describe('a recording deleted', () => {
  test('leaves the history, and the same steps that come to meet are one', () => {
    const history = through(1, 2, 1, 3)
    expect(read(forget(history, 2))).toBe('1 [3]')
  })

  test('Back and Forward skip it', () => {
    const history = forget(back(through(1, 2, 3, 4)), 2)
    expect(read(history)).toBe('1 [3] 4')
    expect(currentStep(back(history))).toBe(1)
  })

  test('the open one leaves a hole that a move takes away', () => {
    const history = forget(back(through(1, 2, 3)), 2)
    expect(read(history)).toBe('1 [_] 3')
    expect(currentStep(history)).toBeUndefined()
    expect(read(back(history))).toBe('[1] 3')
    expect(read(forward(history))).toBe('1 [3]')
  })

  test('a recording opened in place of the hole is a step after the one before it', () => {
    expect(read(visit(forget(through(1, 2), 2), 3))).toBe('1 [3]')
    expect(read(visit(forget(through(1, 2), 2), 1))).toBe('[1]')
  })

  test('one never opened leaves the history as it is', () => {
    const history = through(1, 2)
    expect(forget(history, 9)).toBe(history)
  })

  test('the closed one goes, and nothing open stays', () => {
    expect(read(forget(through(1, null), 1))).toBe('[-]')
  })
})
