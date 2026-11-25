import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { NoteDocument } from '../../api/types'
import { createNoteAutosave, type NoteAutosaveOptions } from './note-autosave'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts: string[]): NoteDocument => ({ type: 'doc', content: texts.map(p) })
const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }
const conflict = () => new ApiError(409, 'The note changed since this version: read it again', 'note_version_conflict')

// The backend's notes with their versions, and what the editor holds (the cache).
function backend() {
  const notes = new Map<number, { content: NoteDocument; version: number }>()
  let last = 0
  const cache = new Map<number, NoteDocument>()
  const write = vi.fn(async (id: number, content: NoteDocument | null, version: number | null): Promise<number | null> => {
    if ((notes.get(id)?.version ?? null) !== version) throw conflict()
    if (content === null) {
      notes.delete(id)
      return null
    }
    notes.set(id, { content, version: ++last })
    return last
  })
  const read = vi.fn(async (id: number) => {
    const note = notes.get(id)
    return { content: note?.content ?? null, version: note?.version ?? null }
  })
  // Another writer: an agent through MCP.
  const elsewhere = (id: number, content: NoteDocument | null) => {
    if (content === null) notes.delete(id)
    else notes.set(id, { content, version: ++last })
    return notes.get(id)?.version ?? null
  }
  return { notes, cache, write, read, elsewhere }
}

function setup(options: Partial<NoteAutosaveOptions> = {}, server = backend()) {
  const onFailure = vi.fn()
  const onConflict = vi.fn()
  const apply = vi.fn((id: number, content: NoteDocument) => { server.cache.set(id, content) })
  const saver = createNoteAutosave({
    write: server.write, read: server.read, local: id => server.cache.get(id), apply, onFailure, onConflict, ...options,
  })
  // The editor: what it types is in the cache at once, and saved after the delay.
  const type = (id: number, content: NoteDocument) => {
    server.cache.set(id, content)
    saver.change(id, content)
  }
  const open = (id: number) => {
    const note = server.notes.get(id)
    server.cache.set(id, note?.content ?? EMPTY)
    saver.loaded(id, { content: note?.content ?? null, version: note?.version ?? null })
  }
  return { saver, ...server, onFailure, onConflict, apply, type, open }
}

const written = (write: ReturnType<typeof backend>['write']) => write.mock.calls.map(([id, content]) => [id, content])

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('saving a note', () => {
  test('a second after the last change, once, with the last document and its version', async () => {
    const { saver, write, open, type } = setup()
    open(1)
    type(1, doc('a'))
    await vi.advanceTimersByTimeAsync(600)
    type(1, doc('ab'))
    await vi.advanceTimersByTimeAsync(999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write.mock.calls).toEqual([[1, doc('ab'), null]])
    expect(saver.pending()).toBe(false)
    type(1, doc('abc'))
    await saver.flush()
    expect(write.mock.calls[1]).toEqual([1, doc('abc'), 1])
  })

  test('an empty note is deleted rather than saved', async () => {
    const { saver, write, elsewhere, open, type } = setup()
    elsewhere(1, doc('a'))
    open(1)
    type(1, EMPTY)
    await saver.flush()
    expect(write.mock.calls).toEqual([[1, null, 1]])
  })

  test('the note as it was loaded is not written back', async () => {
    const { saver, write, elsewhere, open, type } = setup()
    elsewhere(1, doc('a'))
    open(1)
    type(1, doc('a'))
    type(2, EMPTY)
    saver.loaded(2, { content: null, version: null })
    await saver.flush()
    expect(write).not.toHaveBeenCalled()
    expect(saver.pending()).toBe(false)
  })

  test('flush saves at once, and each recording its own note', async () => {
    const { saver, write, open, type } = setup()
    open(1)
    open(2)
    type(1, doc('a'))
    type(2, doc('b'))
    await saver.flush()
    expect(written(write)).toEqual([[1, doc('a')], [2, doc('b')]])
    await vi.advanceTimersByTimeAsync(2000)
    expect(write).toHaveBeenCalledTimes(2)
  })

  test('a note never loaded is read first, to write from its version', async () => {
    const { saver, write, read, elsewhere, type } = setup()
    elsewhere(1, doc('there'))
    type(1, doc('mine'))
    await saver.flush()
    expect(read).toHaveBeenCalledWith(1)
    expect(write.mock.calls).toEqual([[1, doc('mine'), 1]])
  })

  test('one request at a time: a change during a save goes after it, newest only', async () => {
    const server = backend()
    let finish!: () => void
    const write = vi.fn(async (id: number, content: NoteDocument | null, version: number | null) => {
      await new Promise<void>(resolve => { finish = resolve })
      return server.write(id, content, version)
    })
    const { saver, open, type } = setup({ write }, server)
    open(1)
    type(1, doc('a'))
    const first = saver.flush()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    type(1, doc('ab'))
    type(1, doc('abc'))
    const second = saver.flush()
    expect(write).toHaveBeenCalledTimes(1)
    finish()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    finish()
    await first
    await second
    expect(write.mock.calls.map(call => [call[1], call[2]])).toEqual([[doc('a'), null], [doc('abc'), 1]])
  })
})

describe('a note changed elsewhere', () => {
  test('with nothing typed, the open note takes it silently', async () => {
    const { saver, elsewhere, open, apply, cache, write, onConflict } = setup()
    elsewhere(1, doc('a'))
    open(1)
    const v = elsewhere(1, doc('a', 'by the agent'))
    expect(saver.heard(1, v)).toBe(true)
    await saver.flush()
    expect(apply).toHaveBeenCalledWith(1, doc('a', 'by the agent'), null)
    expect(cache.get(1)).toEqual(doc('a', 'by the agent'))
    expect(write).not.toHaveBeenCalled()
    expect(onConflict).not.toHaveBeenCalled()
  })

  test('its own save is known by the version and not read again', async () => {
    const { saver, open, type, read } = setup()
    open(1)
    type(1, doc('a'))
    await saver.flush()
    saver.heard(1, 1)
    await saver.flush()
    expect(read).not.toHaveBeenCalled()
  })

  test('typing not yet saved is merged with it and saved from its version', async () => {
    const { saver, elsewhere, open, type, cache, write, notes } = setup()
    elsewhere(1, doc('first', 'second'))
    open(1)
    type(1, doc('first, typed', 'second'))
    const v = elsewhere(1, doc('first', 'second', 'by the agent'))
    saver.heard(1, v)
    await saver.flush()
    const merged = doc('first, typed', 'second', 'by the agent')
    expect(cache.get(1)).toEqual(merged)
    expect(write.mock.calls).toEqual([[1, merged, v]])
    expect(notes.get(1)!.content).toEqual(merged)
  })

  test('a save refused as stale reads the note, merges and saves again', async () => {
    const { saver, elsewhere, open, type, write, notes, cache, onFailure } = setup()
    elsewhere(1, doc('a', 'b'))
    open(1)
    elsewhere(1, doc('a', 'b', 'c'))  // not heard yet
    type(1, doc('A', 'b'))
    await saver.flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(notes.get(1)!.content).toEqual(doc('A', 'b', 'c'))
    expect(cache.get(1)).toEqual(doc('A', 'b', 'c'))
    expect(onFailure).not.toHaveBeenCalled()
    expect(saver.pending()).toBe(false)
  })

  test('the same paragraph changed on both sides keeps both and says so once', async () => {
    const { saver, elsewhere, open, type, cache, onConflict, notes } = setup()
    elsewhere(1, doc('a'))
    open(1)
    type(1, doc('a, mine'))
    saver.heard(1, elsewhere(1, doc('a, theirs')))
    await saver.flush()
    expect(cache.get(1)).toEqual(doc('a, theirs', 'a, mine'))
    expect(notes.get(1)!.content).toEqual(doc('a, theirs', 'a, mine'))
    expect(onConflict).toHaveBeenCalledTimes(1)
  })

  test('typing during the read is not lost', async () => {
    const server = backend()
    let answer!: () => void
    const read = vi.fn(async (id: number) => {
      await new Promise<void>(resolve => { answer = resolve })
      return server.read(id)
    })
    const { saver, open, type, cache } = setup({ read }, server)
    server.elsewhere(1, doc('a', 'b'))
    open(1)
    saver.heard(1, server.elsewhere(1, doc('a', 'b', 'c')))
    const done = saver.flush()
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    type(1, doc('A', 'b'))
    answer()
    await done
    await saver.flush()
    expect(cache.get(1)).toEqual(doc('A', 'b', 'c'))
    expect(server.notes.get(1)!.content).toEqual(doc('A', 'b', 'c'))
  })

  test('deleted elsewhere with nothing typed: the note is empty', async () => {
    const { saver, elsewhere, open, cache, write } = setup()
    elsewhere(1, doc('a'))
    open(1)
    saver.heard(1, elsewhere(1, null))
    await saver.flush()
    expect(cache.get(1)).toEqual(EMPTY)
    expect(write).not.toHaveBeenCalled()
  })

  test('deleted elsewhere with typing: the typing is saved as a new note', async () => {
    const { saver, elsewhere, open, type, notes } = setup()
    elsewhere(1, doc('a'))
    open(1)
    type(1, doc('a', 'typed'))
    saver.heard(1, elsewhere(1, null))
    await saver.flush()
    expect(notes.get(1)!.content).toEqual(doc('typed'))
  })

  test('a note the saver does not keep is not its business', () => {
    const { saver } = setup()
    expect(saver.heard(7, 3)).toBe(false)
  })

  test('recheck reads every kept note again, for what was missed', async () => {
    const { saver, elsewhere, open, cache } = setup()
    elsewhere(1, doc('a'))
    elsewhere(2, doc('b'))
    open(1)
    open(2)
    elsewhere(2, doc('b', 'missed'))
    saver.recheck()
    await saver.flush()
    expect(cache.get(2)).toEqual(doc('b', 'missed'))
    expect(cache.get(1)).toEqual(doc('a'))
  })

  test('mentions rewritten here are rewritten in what the note was loaded as too', async () => {
    const anna = (id: string, ...more: object[]) => ({ type: 'paragraph', content: [
      { type: 'mention', attrs: { kind: 'speaker', id, label: 'Anna' } }, ...more,
    ] })
    const { saver, elsewhere, open, type, onConflict, cache } = setup()
    elsewhere(1, { type: 'doc', content: [anna('a')] })
    open(1)
    // The speaker merged: the backend rewrote the note, the editor its document.
    saver.followMentions({ kind: 'merge', from: 'a', into: 'b' })
    type(1, { type: 'doc', content: [anna('b', { type: 'text', text: ' typed' })] })
    saver.heard(1, elsewhere(1, { type: 'doc', content: [anna('b'), p('by the agent')] }))
    await saver.flush()
    expect(onConflict).not.toHaveBeenCalled()
    expect(cache.get(1)).toEqual({ type: 'doc', content: [anna('b', { type: 'text', text: ' typed' }), p('by the agent')] })
  })
})

describe('when saving fails', () => {
  test('says so once, keeps the document and tries again on the next flush', async () => {
    const { saver, onFailure, write, open, type } = setup()
    open(1)
    write.mockImplementation(async () => { throw new ApiError(0, 'Failed to fetch') })
    type(1, doc('a'))
    await saver.flush()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0]).toBeInstanceOf(ApiError)
    expect(saver.pending()).toBe(true)
    await saver.flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(onFailure).toHaveBeenCalledTimes(1)
    write.mockImplementation(async () => 1)
    await saver.flush()
    expect(saver.pending()).toBe(false)
    write.mockImplementation(async () => { throw new ApiError(500, 'Server error 500') })
    type(1, doc('b'))
    await saver.flush()
    expect(onFailure).toHaveBeenCalledTimes(2)
  })

  test('a change made while a save fails is kept over the failed one', async () => {
    let fail!: (error: Error) => void
    const write = vi.fn((_id: number, _doc: NoteDocument | null, _version: number | null) => new Promise<number | null>((_resolve, reject) => { fail = reject }))
    const { saver, open, type } = setup({ write })
    open(1)
    type(1, doc('a'))
    const first = saver.flush()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    type(1, doc('ab'))
    fail(new ApiError(0, 'Failed to fetch'))
    await first
    write.mockImplementation(async () => 1)
    await saver.flush()
    expect(write.mock.calls.at(-1)).toEqual([1, doc('ab'), null])
  })

  test('a read that fails is tried again on the next flush', async () => {
    const { saver, elsewhere, open, read, cache, onFailure } = setup()
    elsewhere(1, doc('a'))
    open(1)
    const real = read.getMockImplementation()!
    read.mockImplementationOnce(async () => { throw new ApiError(0, 'Failed to fetch') })
    saver.heard(1, elsewhere(1, doc('a', 'b')))
    await saver.flush()
    expect(onFailure).toHaveBeenCalledTimes(1)
    read.mockImplementation(real)
    await saver.flush()
    expect(cache.get(1)).toEqual(doc('a', 'b'))
  })

  test('a recording already gone is not a failure', async () => {
    const { saver, onFailure, write, open, type } = setup()
    open(1)
    write.mockImplementation(async () => { throw new ApiError(404, 'Transcript not found') })
    type(1, doc('a'))
    await saver.flush()
    expect(onFailure).not.toHaveBeenCalled()
    expect(saver.pending()).toBe(false)
  })
})
