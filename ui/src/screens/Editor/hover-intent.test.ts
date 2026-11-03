import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createKeyStore } from '../../media/active-segment'
import { HOVER_DELAY, HOVER_SKIP } from '../../styles/motion'
import { createHoverIntent } from './hover-intent'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function setup() {
  const store = createKeyStore<string | null>(null)
  return { store, intent: createHoverIntent(store) }
}

test('the delays come from the motion tokens', () => {
  expect(HOVER_DELAY).toBe(150)
  expect(HOVER_SKIP).toBe(300)
})

test('a speaker lights up once the pointer has stayed on it for the delay', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  vi.advanceTimersByTime(HOVER_DELAY - 1)
  expect(store.get()).toBeNull()
  vi.advanceTimersByTime(1)
  expect(store.get()).toBe('anna')
})

test('a pointer passing over lights up nothing', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  vi.advanceTimersByTime(HOVER_DELAY - 1)
  intent.leave('anna')
  intent.enter('mark')
  vi.advanceTimersByTime(HOVER_DELAY - 1)
  intent.leave('mark')
  vi.advanceTimersByTime(HOVER_DELAY * 2)
  expect(store.get()).toBeNull()
})

test('moving on to the next speaker starts the wait again', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  vi.advanceTimersByTime(HOVER_DELAY - 1)
  intent.enter('mark')
  vi.advanceTimersByTime(HOVER_DELAY - 1)
  expect(store.get()).toBeNull()
  vi.advanceTimersByTime(1)
  expect(store.get()).toBe('mark')
})

test('while a speaker is lit, the next one lights up at once', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  vi.advanceTimersByTime(HOVER_DELAY)
  intent.enter('mark')
  expect(store.get()).toBe('mark')
})

test('leaving takes the highlight away at once', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  vi.advanceTimersByTime(HOVER_DELAY)
  intent.leave('anna')
  expect(store.get()).toBeNull()
})

test('right after the highlight went out the next speaker comes at once, later it waits again', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  vi.advanceTimersByTime(HOVER_DELAY)
  intent.leave('anna')
  vi.advanceTimersByTime(HOVER_SKIP - 1)
  intent.enter('mark')
  expect(store.get()).toBe('mark')

  intent.leave('mark')
  vi.advanceTimersByTime(HOVER_SKIP)
  intent.enter('anna')
  expect(store.get()).toBeNull()
  vi.advanceTimersByTime(HOVER_DELAY)
  expect(store.get()).toBe('anna')
})

test('leaving another speaker leaves the lit one alone', () => {
  const { store, intent } = setup()
  intent.focus('anna')
  intent.leave('mark')
  expect(store.get()).toBe('anna')
})

test('leaving with no speaker named takes away whatever is lit or waiting', () => {
  const { store, intent } = setup()
  intent.focus('anna')
  intent.leave()
  expect(store.get()).toBeNull()
  vi.advanceTimersByTime(HOVER_SKIP)
  intent.enter('mark')
  intent.leave()
  vi.advanceTimersByTime(HOVER_DELAY)
  expect(store.get()).toBeNull()
})

test('the focus lights up at once', () => {
  const { store, intent } = setup()
  intent.focus('anna')
  expect(store.get()).toBe('anna')
})

test('a wait cancelled lights up nothing', () => {
  const { store, intent } = setup()
  intent.enter('anna')
  intent.cancel()
  vi.advanceTimersByTime(HOVER_DELAY)
  expect(store.get()).toBeNull()
})
