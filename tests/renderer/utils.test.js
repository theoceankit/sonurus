const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { fileUrl } = loadRenderer(['utils.js'])

test('fileUrl: plain POSIX path', () => {
  assert.equal(fileUrl('/home/u/rec.wav'), 'file:///home/u/rec.wav')
})

test('fileUrl: spaces and Cyrillic are percent-encoded', () => {
  assert.equal(
    fileUrl('/home/u/Запись 1.wav'),
    'file:///home/u/%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%201.wav',
  )
})

test('fileUrl: # and ? do not truncate the path', () => {
  assert.equal(fileUrl('/tmp/a#1?.wav'), 'file:///tmp/a%231%3F.wav')
})

test('fileUrl: Windows drive path', () => {
  assert.equal(fileUrl('C:\\Users\\a b\\x.wav'), 'file:///C:/Users/a%20b/x.wav')
})

test('fileUrl: result is stable under WHATWG URL normalisation', () => {
  // The editor compares against audio.src, which the browser normalises.
  for (const p of ['/home/u/Запись 1.wav', '/tmp/a#1?.wav', 'C:\\x y\\z.wav', "/a/(b)'c.wav"]) {
    assert.equal(new URL(fileUrl(p)).href, fileUrl(p))
  }
})
