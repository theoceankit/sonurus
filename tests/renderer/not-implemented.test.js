const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { loadRenderer } = require('./load-renderer')

const RENDERER_DIR = path.join(__dirname, '..', '..', 'electron', 'renderer')
const MODULE_FILE = 'not-implemented.js'

const ctx = loadRenderer([MODULE_FILE])
const { markNotImplemented, notImplementedClick, installNotImplementedGuard } = ctx
const REGISTRY = [...vm.runInContext('NOT_IMPLEMENTED', ctx)]
const TOAST = vm.runInContext('NOT_IMPLEMENTED_TOAST', ctx)

// Every control found by the audit of unimplemented UI. A feature that
// implements one removes its id here, in the registry and at the call site.
const EXPECTED_IDS = [
  'recording.diarize',
  'settings.export',
  'settings.app-language',
  'settings.include-mic',
  'sidebar.filter-notes',
  'sidebar.filter-marked',
  'titlebar.search',
  'titlebar.share',
  'editor.tab-chapters',
  'editor.tab-notes',
  'editor.tab-activity',
  'editor.add-tag',
  'editor.highlight',
  'segment.bookmark',
]

// Quoted string that looks like a control id: '<area>.<name>'.
const ID_LITERAL = /['"`]((?:recording|settings|sidebar|titlebar|editor|segment)\.[a-z]+(?:-[a-z]+)*)['"`]/g

function rendererSources() {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(js|html)$/.test(entry.name)) out.push(p)
    }
  }
  walk(RENDERER_DIR)
  return out.map(p => ({ rel: path.relative(RENDERER_DIR, p), text: fs.readFileSync(p, 'utf8') }))
}

// Call sites: every renderer source except the module itself.
const callSites = rendererSources().filter(s => s.rel !== MODULE_FILE)

function fakeElement() {
  const classes = new Set()
  const attrs = {}
  return {
    dataset: {},
    classList: { add: c => classes.add(c), contains: c => classes.has(c) },
    setAttribute: (k, v) => { attrs[k] = String(v) },
    attrs,
  }
}

function fakeClick(markedAncestor) {
  const calls = []
  return {
    calls,
    target: { closest: sel => (sel === '[data-not-implemented]' ? markedAncestor : null) },
    preventDefault: () => calls.push('preventDefault'),
    stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
    stopPropagation: () => calls.push('stopPropagation'),
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

test('registry: lists exactly the unimplemented controls', () => {
  assert.deepEqual([...REGISTRY].sort(), [...EXPECTED_IDS].sort())
})

test('toast: one text for every unimplemented control', () => {
  assert.equal(TOAST, 'Not available yet')
})

// ── markNotImplemented ────────────────────────────────────────────────────────

test('markNotImplemented: marks a registered control', () => {
  const el = fakeElement()
  assert.equal(markNotImplemented(el, 'titlebar.share'), el)
  assert.equal(el.dataset.notImplemented, 'titlebar.share')
  assert.ok(el.classList.contains('not-implemented'))
  assert.equal(el.attrs['aria-disabled'], 'true')
})

test('markNotImplemented: leaves a control with an unregistered id alone', () => {
  const el = fakeElement()
  assert.equal(markNotImplemented(el, 'titlebar.export'), el)
  assert.equal(el.dataset.notImplemented, undefined)
  assert.ok(!el.classList.contains('not-implemented'))
  assert.equal(el.attrs['aria-disabled'], undefined)
})

// ── Click guard ───────────────────────────────────────────────────────────────

test('notImplementedClick: a click on a marked control only shows the toast', () => {
  const toasts = []
  const e = fakeClick({ dataset: { notImplemented: 'segment.bookmark' } })
  notImplementedClick(e, t => toasts.push(t))
  assert.ok(e.calls.includes('preventDefault'))
  assert.ok(e.calls.includes('stopImmediatePropagation'))
  assert.deepEqual(toasts, ['Not available yet'])
})

test('notImplementedClick: a click inside a marked container is stopped too', () => {
  // closest() finds the marked ancestor (e.g. the Settings → Export card)
  const toasts = []
  const e = fakeClick({ dataset: { notImplemented: 'settings.export' } })
  notImplementedClick(e, t => toasts.push(t))
  assert.ok(e.calls.includes('stopImmediatePropagation'))
  assert.equal(toasts.length, 1)
})

test('notImplementedClick: a click elsewhere passes through untouched', () => {
  const toasts = []
  const e = fakeClick(null)
  notImplementedClick(e, t => toasts.push(t))
  assert.deepEqual(e.calls, [])
  assert.deepEqual(toasts, [])
})

test('installNotImplementedGuard: listens to clicks in the capture phase', () => {
  const added = []
  installNotImplementedGuard({ addEventListener: (type, fn, opts) => added.push({ type, fn, opts }) })
  assert.equal(added.length, 1)
  assert.equal(added[0].type, 'click')
  assert.ok(added[0].opts === true || added[0].opts?.capture === true)
  assert.equal(typeof added[0].fn, 'function')
})

// ── Call sites (source scan) ──────────────────────────────────────────────────

test('call sites: every registered id marks exactly one control', () => {
  for (const id of EXPECTED_IDS) {
    const hits = callSites.flatMap(s =>
      [...s.text.matchAll(ID_LITERAL)].filter(m => m[1] === id).map(() => s.rel))
    assert.equal(hits.length, 1, `${id} used at ${hits.length} call sites: ${hits.join(', ')}`)
  }
})

test('call sites: no id outside the registry (remove both when a feature lands)', () => {
  const registered = new Set(REGISTRY)
  for (const s of callSites) {
    for (const m of s.text.matchAll(ID_LITERAL)) {
      assert.ok(registered.has(m[1]), `${s.rel}: '${m[1]}' is not in the NOT_IMPLEMENTED registry`)
    }
  }
})

test('call sites: files with an id call markNotImplemented', () => {
  for (const s of callSites) {
    if ([...s.text.matchAll(ID_LITERAL)].length) {
      assert.match(s.text, /markNotImplemented\(/, `${s.rel} has an id but never marks a control`)
    }
  }
})

test('no ad-hoc "not implemented" toasts or TODO markers remain', () => {
  for (const s of callSites) {
    assert.doesNotMatch(s.text, /not available yet/i, s.rel)
    assert.doesNotMatch(s.text, /coming in a future update/i, s.rel)
    assert.doesNotMatch(s.text, /TODO\(not implemented\)/, s.rel)
  }
})

// ── Wiring ────────────────────────────────────────────────────────────────────

test('index.html loads the module before the views and app.js', () => {
  const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8')
  const at = src => html.indexOf(`<script src="${src}"></script>`)
  assert.ok(at(MODULE_FILE) > -1, 'not-implemented.js is not loaded')
  assert.ok(at(MODULE_FILE) < at('components.js'))
  assert.ok(at(MODULE_FILE) < at('views/editor-view.js'))
  assert.ok(at(MODULE_FILE) < at('app.js'))
})

test('app.js installs the click guard on the document', () => {
  const app = fs.readFileSync(path.join(RENDERER_DIR, 'app.js'), 'utf8')
  assert.match(app, /installNotImplementedGuard\(document\)/)
})
