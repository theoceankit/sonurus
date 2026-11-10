import { afterEach, describe, expect, test } from 'vitest'
import { addFiles, defaultTitle, importingMessage, isSupportedAudio, queueTitles, renameFile, skippedMessage, splitName, SUPPORTED_EXTENSIONS, watchFileDrags } from './import-files'

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

describe('titles', () => {
  const files = (...names: string[]) => names.map(name => ({ name, path: `/in/${name}` }))

  test('the hint is the date and time of the opening', () => {
    expect(defaultTitle(new Date(2026, 10, 5, 9, 7))).toBe('5 Nov 09:07 Meeting')
  })

  test('a file renamed keeps its title; one not renamed is named after itself (null)', () => {
    const [a, b] = files('a.mp3', 'b.wav')
    expect(queueTitles([{ ...a, title: 'Weekly sync' }, b])).toEqual(['Weekly sync', null])
  })
})

describe('renaming a file', () => {
  const files = (...names: string[]) => names.map(name => ({ name, path: `/in/${name}` }))

  test('the extension is apart from the name, and stays', () => {
    expect(splitName('Team call.m4a')).toEqual({ stem: 'Team call', extension: '.m4a' })
    expect(splitName('v1.2 notes.WAV')).toEqual({ stem: 'v1.2 notes', extension: '.WAV' })
    expect(splitName('noextension')).toEqual({ stem: 'noextension', extension: '' })
  })

  test('takes the typed title, trimmed, for that file only', () => {
    const renamed = renameFile(files('a.mp3', 'b.mp3'), '/in/b.mp3', '  Retro ')
    expect(renamed.map(file => file.title)).toEqual([undefined, 'Retro'])
  })

  test('a blank title, or the file name itself, names it after the file again', () => {
    const renamed = renameFile([{ name: 'a.mp3', path: '/in/a.mp3', title: 'Retro' }], '/in/a.mp3', '   ')
    expect(renamed[0].title).toBeUndefined()
    expect(renameFile(files('a.mp3'), '/in/a.mp3', 'a')[0].title).toBeUndefined()
  })
})
