import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { createNoteAutosave } from './note-autosave'

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }

function setup(write = vi.fn(async (_id: number, _doc: object | null) => {})) {
  const onFailure = vi.fn()
  const saver = createNoteAutosave({ write, onFailure })
  return { saver, write, onFailure }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('saving a note', () => {
  test('a second after the last change, once, with the last document', async () => {
    const { saver, write } = setup()
    saver.change(1, doc('a'))
    await vi.advanceTimersByTimeAsync(600)
    saver.change(1, doc('ab'))
    await vi.advanceTimersByTimeAsync(999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write.mock.calls).toEqual([[1, doc('ab')]])
    expect(saver.pending()).toBe(false)
  })

  test('an empty note is deleted rather than saved', async () => {
    const { saver, write } = setup()
    saver.change(1, EMPTY)
    await saver.flush()
    expect(write.mock.calls).toEqual([[1, null]])
  })

  test('flush saves at once, and each recording its own note', async () => {
    const { saver, write } = setup()
    saver.change(1, doc('a'))
    saver.change(2, doc('b'))
    await saver.flush()
    expect(write.mock.calls).toEqual([[1, doc('a')], [2, doc('b')]])
    await vi.advanceTimersByTimeAsync(2000)
    expect(write).toHaveBeenCalledTimes(2)
  })

  test('one request at a time: a change during a save goes after it, newest only', async () => {
    let finish!: () => void
    const write = vi.fn((_id: number, _doc: object | null) => new Promise<void>(resolve => { finish = resolve }))
    const { saver } = setup(write)
    saver.change(1, doc('a'))
    const first = saver.flush()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    saver.change(1, doc('ab'))
    saver.change(1, doc('abc'))
    const second = saver.flush()
    expect(write).toHaveBeenCalledTimes(1)
    finish()
    await first
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    finish()
    await second
    expect(write.mock.calls.map(call => call[1])).toEqual([doc('a'), doc('abc')])
  })
})

describe('when saving fails', () => {
  test('says so once, keeps the document and tries again on the next flush', async () => {
    const write = vi.fn(async (_id: number, _doc: object | null): Promise<void> => { throw new ApiError(0, 'Failed to fetch') })
    const { saver, onFailure } = setup(write)
    saver.change(1, doc('a'))
    await saver.flush()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0]).toBeInstanceOf(ApiError)
    expect(saver.pending()).toBe(true)
    await saver.flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(onFailure).toHaveBeenCalledTimes(1)
    write.mockImplementation(async () => {})
    await saver.flush()
    expect(saver.pending()).toBe(false)
    write.mockImplementation(async () => { throw new ApiError(500, 'Server error 500') })
    saver.change(1, doc('b'))
    await saver.flush()
    expect(onFailure).toHaveBeenCalledTimes(2)
  })

  test('a change made while a save fails is kept over the failed one', async () => {
    let fail!: (error: Error) => void
    const write = vi.fn((_id: number, _doc: object | null) => new Promise<void>((_resolve, reject) => { fail = reject }))
    const { saver } = setup(write)
    saver.change(1, doc('a'))
    const first = saver.flush()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    saver.change(1, doc('ab'))
    fail(new ApiError(0, 'Failed to fetch'))
    await first
    write.mockImplementation(async () => {})
    await saver.flush()
    expect(write.mock.calls.at(-1)).toEqual([1, doc('ab')])
  })

  test('a recording already gone is not a failure', async () => {
    const write = vi.fn(async (_id: number, _doc: object | null): Promise<void> => { throw new ApiError(404, 'Transcript not found') })
    const { saver, onFailure } = setup(write)
    saver.change(1, doc('a'))
    await saver.flush()
    expect(onFailure).not.toHaveBeenCalled()
    expect(saver.pending()).toBe(false)
  })
})
