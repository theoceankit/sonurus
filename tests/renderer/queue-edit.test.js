const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRenderer } = require('./load-renderer')

const { canEditJob, jobEditPatch, jobEditRequest, reorderJobIds, dropPlace } = loadRenderer(['utils.js'])

const plain = v => JSON.parse(JSON.stringify(v))
const job = over => ({
  id: 'j1', audio_path: '/rec/sonorus-import-1.wav', title: 'Weekly sync',
  whisper_model: 'small', language: null, status: 'waiting',
  error: null, error_code: null, error_language: null, created_at: '', ...over,
})
const form = over => ({ title: 'Weekly sync', model: 'small', language: 'auto', ...over })

// ── Edit ───────────────────────────────────────────────────────────────────────

test('canEditJob: every job except the running one', () => {
  assert.equal(canEditJob(job()), true)
  assert.equal(canEditJob(job({ status: 'failed' })), true)
  assert.equal(canEditJob(job({ status: 'running' })), false)
})

test('jobEditPatch: nothing changed → no patch', () => {
  assert.deepEqual(plain(jobEditPatch(job(), form())), { patch: null })
  assert.deepEqual(plain(jobEditPatch(job(), form({ title: '  Weekly sync ' }))), { patch: null })
})

test('jobEditPatch: only the changed fields, title trimmed', () => {
  assert.deepEqual(plain(jobEditPatch(job(), form({ title: ' Standup ', model: 'large-v3' }))),
    { patch: { title: 'Standup', whisper_model: 'large-v3' } })
})

test('jobEditPatch: language — auto means null', () => {
  assert.deepEqual(plain(jobEditPatch(job(), form({ language: 'ru' }))), { patch: { language: 'ru' } })
  assert.deepEqual(plain(jobEditPatch(job({ language: 'ru' }), form({ language: 'auto' }))),
    { patch: { language: null } })
  assert.deepEqual(plain(jobEditPatch(job({ language: 'ru' }), form({ language: 'ru' }))), { patch: null })
})

test('jobEditPatch: blank or too long title is an error', () => {
  assert.match(jobEditPatch(job(), form({ title: '   ' })).error, /empty/i)
  assert.match(jobEditPatch(job(), form({ title: 'x'.repeat(201) })).error, /200/)
  assert.equal(jobEditPatch(job(), form({ title: 'x'.repeat(200) })).error, undefined)
})

test('jobEditRequest: PATCH /queue/jobs/{id} with the patch', () => {
  assert.deepEqual(plain(jobEditRequest('j1', { title: 'Standup' })), {
    url: 'http://localhost:8000/queue/jobs/j1', method: 'PATCH', body: { title: 'Standup' },
  })
})

// ── Drag order ─────────────────────────────────────────────────────────────────

test('reorderJobIds: before / after the target', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.deepEqual(plain(reorderJobIds(ids, 'd', 'b', 'before')), ['a', 'd', 'b', 'c'])
  assert.deepEqual(plain(reorderJobIds(ids, 'a', 'c', 'after')), ['b', 'c', 'a', 'd'])
  assert.deepEqual(plain(reorderJobIds(ids, 'a', 'd', 'after')), ['b', 'c', 'd', 'a'])
  assert.deepEqual(plain(reorderJobIds(ids, 'c', 'a', 'before')), ['c', 'a', 'b', 'd'])
})

test('reorderJobIds: onto itself or an unknown id → the same order', () => {
  const ids = ['a', 'b', 'c']
  assert.deepEqual(plain(reorderJobIds(ids, 'b', 'b', 'after')), ids)
  assert.deepEqual(plain(reorderJobIds(ids, 'x', 'b', 'after')), ids)
  assert.deepEqual(plain(reorderJobIds(ids, 'a', 'x', 'after')), ids)
})

test('reorderJobIds: does not change the input', () => {
  const ids = ['a', 'b']
  reorderJobIds(ids, 'a', 'b', 'after')
  assert.deepEqual(ids, ['a', 'b'])
})

test('dropPlace: upper half → before, lower half → after', () => {
  assert.equal(dropPlace({ top: 100, height: 40 }, 110), 'before')
  assert.equal(dropPlace({ top: 100, height: 40 }, 119), 'before')
  assert.equal(dropPlace({ top: 100, height: 40 }, 120), 'after')
  assert.equal(dropPlace({ top: 100, height: 40 }, 139), 'after')
})
