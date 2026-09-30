const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

// The editor is rebuilt after every speaker change; the player bar and the playing
// row must come back in the state of the audio element, which outlives the rebuild.
const { playerClock, activeSegmentIndex } = loadRenderer(['utils.js'])

test('playerClock: time, duration and play state come from the audio element', () => {
  assert.deepEqual({ ...playerClock({ currentTime: 65.4, duration: 305.2, paused: true }) },
    { elapsed: '01:05', total: '05:05', playing: false })
  assert.equal(playerClock({ currentTime: 3, duration: 10, paused: false }).playing, true)
})

test('playerClock: duration not known yet shows 00:00', () => {
  assert.equal(playerClock({ currentTime: 0, duration: NaN, paused: true }).total, '00:00')
  assert.equal(playerClock({ currentTime: 0, duration: Infinity, paused: true }).total, '00:00')
})

const SEGS = [{ start: 0, end: 4 }, { start: 5, end: 9 }, { start: 9, end: 12 }]

test('activeSegmentIndex: the segment that contains the time', () => {
  assert.equal(activeSegmentIndex(SEGS, 2), 0)
  assert.equal(activeSegmentIndex(SEGS, 5), 1)    // start is inside
  assert.equal(activeSegmentIndex(SEGS, 9), 2)    // end is not: the next segment starts there
  assert.equal(activeSegmentIndex(SEGS, 11.9), 2)
})

test('activeSegmentIndex: -1 between, before and after segments', () => {
  assert.equal(activeSegmentIndex(SEGS, 4.5), -1)
  assert.equal(activeSegmentIndex(SEGS, -1), -1)
  assert.equal(activeSegmentIndex(SEGS, 12), -1)
  assert.equal(activeSegmentIndex([], 1), -1)
})
