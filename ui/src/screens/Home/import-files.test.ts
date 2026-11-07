import { afterEach, describe, expect, test } from 'vitest'
import { ApiError } from '../../api/client'
import { addFiles, importFailure, importingMessage, isSupportedAudio, skippedMessage, SUPPORTED_EXTENSIONS, watchFileDrags } from './import-files'

const f = (name: string, path = `/in/${name}`) => ({ name, path })

describe('isSupportedAudio', () => {
  test('takes the extensions of the file dialog, in any case', () => {
    for (const extension of SUPPORTED_EXTENSIONS) expect(isSupportedAudio(`call.${extension}`), extension).toBe(true)
    expect(isSupportedAudio('CALL.MP3')).toBe(true)
    expect(isSupportedAudio('my.meeting.final.Wav')).toBe(true)
  })

  test('refuses other files', () => {
    for (const name of ['notes.txt', 'mp3', 'archive.mp3.zip', '', undefined]) expect(isSupportedAudio(name), String(name)).toBe(false)
  })
})

describe('addFiles', () => {
  test('keeps the order and counts what it skips', () => {
    expect(addFiles([], [f('a.txt'), f('b.mp3'), f('c.pdf'), f('d.WAV')])).toEqual({ files: [f('b.mp3'), f('d.WAV')], skipped: ['a.txt', 'c.pdf'] })
  })

  test('only unsupported files add nothing', () => {
    expect(addFiles([f('a.mp3')], [f('a.txt')])).toEqual({ files: [f('a.mp3')], skipped: ['a.txt'] })
  })

  test('a file already in the list is not added again or counted', () => {
    expect(addFiles([f('a.mp3')], [f('a.mp3'), f('b.mp3')])).toEqual({ files: [f('a.mp3'), f('b.mp3')], skipped: [] })
  })

  test('a file with no path on disk cannot be imported', () => {
    expect(addFiles([], [f('a.mp3', '')])).toEqual({ files: [], skipped: ['a.mp3'] })
  })
})

test('the toast names one file, and counts several', () => {
  expect(importingMessage([f('Team call.m4a')])).toBe('Importing Team call.m4a…')
  expect(importingMessage([f('a.mp3'), f('b.mp3')])).toBe('Importing 2 files…')
})

test('skipped files are named, or counted when there are several', () => {
  expect(skippedMessage(['notes.txt'])).toBe('notes.txt was not imported: this file type is not supported.')
  expect(skippedMessage(['a.txt', 'b.pdf', 'c.zip'])).toBe('3 files were not imported: these file types are not supported.')
})

test('a refusal says what is wrong, and a missing model leads to Settings', () => {
  expect(importFailure(new ApiError(400, 'Diarization model is not installed. Download it in Settings.'))).toEqual({
    message: 'Diarization model is not installed. Download it in Settings.', missingModels: true,
  })
  expect(importFailure(new ApiError(400, 'audio_path not readable: /in/a.mp3')).missingModels).toBe(false)
  expect(importFailure(new ApiError(0, 'Failed to fetch'))).toEqual({ message: 'The backend is not responding.', missingModels: false })
})

describe('watchFileDrags', () => {
  let stop = () => {}
  afterEach(() => stop())

  // jsdom has no DragEvent or DataTransfer.
  function setup() {
    const calls: string[] = []
    const dropped: string[][] = []
    stop = watchFileDrags(window, {
      onEnter: () => calls.push('enter'),
      onLeave: () => calls.push('leave'),
      onDrop: files => { calls.push('drop'); dropped.push(files.map(file => file.name)) },
    })
    const fire = (type: string, { files = ['a.mp3'], types = ['Files'], prevented = false } = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      const dataTransfer = { types, files: files.map(name => new File([], name)), dropEffect: 'none' }
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      if (prevented) event.preventDefault()
      document.body.dispatchEvent(event)
      return { event, dataTransfer }
    }
    return { fire, calls, dropped }
  }

  test('a drop of files hands them over and is cancelled', () => {
    const { fire, calls, dropped } = setup()
    fire('dragenter')
    const { event } = fire('drop', { files: ['a.mp3', 'b.txt'] })
    expect(event.defaultPrevented).toBe(true)
    expect(calls).toEqual(['enter', 'drop'])
    expect(dropped).toEqual([['a.mp3', 'b.txt']])
  })

  test('only the first enter and the last leave count', () => {
    const { fire, calls } = setup()
    fire('dragenter')
    fire('dragenter') // a child element
    fire('dragleave')
    expect(calls).toEqual(['enter'])
    fire('dragleave')
    expect(calls).toEqual(['enter', 'leave'])
  })

  test('a drop a zone below took already is not handed over twice', () => {
    const { fire, calls } = setup()
    fire('dragenter')
    fire('drop', { prevented: true })
    expect(calls).toEqual(['enter', 'leave'])
  })

  test('after a drop the next drag counts from the start', () => {
    const { fire, calls } = setup()
    fire('dragenter')
    fire('dragenter')
    fire('drop')
    fire('dragenter')
    expect(calls).toEqual(['enter', 'drop', 'enter'])
  })

  test('drags without files are left alone', () => {
    const { fire, calls } = setup()
    for (const type of ['dragenter', 'dragover', 'drop']) expect(fire(type, { types: ['text/plain'] }).event.defaultPrevented, type).toBe(false)
    expect(calls).toEqual([])
  })

  test('a drag of files shows a copy and can be dropped anywhere', () => {
    const { fire } = setup()
    const { event, dataTransfer } = fire('dragover')
    expect(event.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
  })

  test('stopping removes the listeners', () => {
    const { fire, calls } = setup()
    stop()
    fire('dragenter')
    expect(calls).toEqual([])
  })
})
