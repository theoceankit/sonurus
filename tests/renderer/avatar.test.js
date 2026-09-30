const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRenderer } = require('./load-renderer')

const RENDERER_DIR = path.join(__dirname, '..', '..', 'electron', 'renderer')

// Minimal DOM: just what the avatar helpers touch.
function fakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(), className: '', textContent: '', title: '', style: {}, children: [],
    appendChild(child) { el.children.push(child); return child },
    append(...kids) { kids.forEach(k => el.children.push(k)) },
  }
  el.classList = {
    add: (...names) => { el.className = [...new Set([...el.className.split(' ').filter(Boolean), ...names])].join(' ') },
    contains: name => el.className.split(' ').includes(name),
  }
  return el
}
const document = { createElement: fakeElement }

const { makeAvatar, makeNameAvatar, setAvatarName, makeAvatarStack } = loadRenderer(['utils.js'], { document })

const ALICE = 'a1a1a1a1-0000-4000-8000-000000000001'
const BOB = 'b2b2b2b2-0000-4000-8000-000000000002'
const known = { [ALICE]: { name: 'Alice Brown', colorIndex: 0 }, [BOB]: { name: 'Bob', colorIndex: 2 } }

// ── makeAvatar ──────────────────────────────────────────────────────────────────

test('makeAvatar: recognized speaker gets initials, palette color and a size class', () => {
  const el = makeAvatar(ALICE, 'Alice Brown', 'sm', known)
  assert.equal(el.className, 'spk-avatar spk-avatar--sm')
  assert.equal(el.textContent, 'AB')
  assert.equal(el.style.background, '#5B8A72')
})

test('makeAvatar: size comes from CSS only, never inline', () => {
  const el = makeAvatar(ALICE, 'Alice Brown', 'lg', known)
  for (const prop of ['width', 'height', 'fontSize']) assert.equal(el.style[prop], undefined, prop)
})

test('makeAvatar: default size is md', () => {
  assert.ok(makeAvatar(BOB, 'Bob', undefined, known).classList.contains('spk-avatar--md'))
})

test('makeAvatar: unrecognized speaker is a grey "?"', () => {
  for (const id of ['SPEAKER_00', 'c3c3c3c3-0000-4000-8000-000000000003']) {
    const el = makeAvatar(id, 'Speaker 1', 'xs', known)
    assert.equal(el.textContent, '?')
    assert.ok(el.classList.contains('spk-avatar--unknown'))
    assert.ok(el.classList.contains('spk-avatar--xs'))
    assert.equal(el.style.background, undefined)
  }
})

test('makeAvatar: a size outside the presets is an error', () => {
  for (const size of [28, '28px', 'xl', '']) {
    assert.throws(() => makeAvatar(ALICE, 'Alice Brown', size, known), /avatar size/i, String(size))
  }
})

// ── makeNameAvatar / setAvatarName (New speaker preview) ────────────────────────

test('makeNameAvatar: initials and color without a speaker id', () => {
  const el = makeNameAvatar('Zoe Quinn', '#C56E5A', 'md')
  assert.equal(el.className, 'spk-avatar spk-avatar--md')
  assert.equal(el.textContent, 'ZQ')
  assert.equal(el.style.background, '#C56E5A')
})

test('makeNameAvatar: empty name is a circle without letters', () => {
  assert.equal(makeNameAvatar('', '#C56E5A', 'md').textContent, '')
})

test('setAvatarName: updates initials and color in place', () => {
  const el = makeNameAvatar('', '#C56E5A', 'md')
  setAvatarName(el, 'Ann Lee', '#5670A6')
  assert.equal(el.textContent, 'AL')
  assert.equal(el.style.background, '#5670A6')
  setAvatarName(el, '   ', '#5670A6')
  assert.equal(el.textContent, '')
})

// ── makeAvatarStack ─────────────────────────────────────────────────────────────

test('makeAvatarStack: at most max avatars, first one on top', () => {
  const ids = [ALICE, 'SPEAKER_01', BOB, 'SPEAKER_02']
  const stack = makeAvatarStack(ids, 'xs', known, { max: 3, nameOf: id => known[id]?.name || id })
  assert.equal(stack.className, 'spk-avatar-stack')
  assert.equal(stack.children.length, 3)
  assert.deepEqual(stack.children.map(c => c.textContent), ['AB', '?', 'BO'])
  assert.deepEqual(stack.children.map(c => String(c.style.zIndex)), ['3', '2', '1'])
  assert.ok(stack.children.every(c => c.classList.contains('spk-avatar--xs')))
  assert.ok(stack.children.every(c => !c.title))
})

test('makeAvatarStack: titles show the speaker name on hover', () => {
  const stack = makeAvatarStack([ALICE, BOB], 'sm', known, { max: 5, nameOf: id => known[id].name, titles: true })
  assert.deepEqual(stack.children.map(c => c.title), ['Alice Brown', 'Bob'])
})

// ── Guards ──────────────────────────────────────────────────────────────────────

function sources(ext) {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (ext.test(entry.name)) out.push(p)
    }
  }
  walk(RENDERER_DIR)
  return out
}

function cssRule(selector) {
  const css = sources(/\.css$/).map(f => fs.readFileSync(f, 'utf8')).join('\n')
  const esc = selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`))
  return m && m[1]
}

test('speaker initials are rendered only by the avatar component in utils.js', () => {
  const found = []
  for (const file of sources(/\.(js|html)$/)) {
    if (path.basename(file) === 'utils.js') continue
    if (/\bspeakerInitials\(/.test(fs.readFileSync(file, 'utf8'))) found.push(path.relative(RENDERER_DIR, file))
  }
  assert.deepEqual(found, [], 'use makeAvatar() / makeNameAvatar() instead of building an avatar by hand')
})

test('old per-place avatar classes are gone', () => {
  const old = /\b(rec-avatars?|seg-spk-av|focus-header-av|focus-avatar-group|spk-picker-av|ns-av)\b/
  const found = sources(/\.(js|html|css)$/)
    .filter(f => old.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(RENDERER_DIR, f))
  assert.deepEqual(found, [])
})

test('avatar initials cannot be selected', () => {
  const rule = cssRule('.spk-avatar')
  assert.ok(rule, '.spk-avatar rule not found')
  assert.match(rule, /user-select:\s*none/)
})

test('every avatar size preset has a CSS rule with its size and font', () => {
  for (const size of ['xs', 'sm', 'md', 'lg']) {
    const rule = cssRule(`.spk-avatar--${size}`)
    assert.ok(rule, `.spk-avatar--${size} rule not found`)
    for (const prop of ['width', 'height', 'font-size']) assert.match(rule, new RegExp(`(^|[;\\s])${prop}:`), `${size}: ${prop}`)
  }
})
