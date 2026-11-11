import { createRequire } from 'node:module'

// jsdom works out a computed style by matching every style rule against the
// element, and skips a rule early when the element lacks the class, id, tag or
// attribute that the rightmost part of its selector requires. It finds none
// inside :where(), so every :where() rule of control.module.css and
// motion.module.css goes through the slow matcher for every element, and
// getByRole, which asks for the style of each node it names, spends most of a
// screen test there. Here the keys of `:where(X)` are taken from X. A key only
// lets the matcher skip what could not match anyway, so the cascade is the
// same; test-css-prefilter.test.ts checks both.

export interface SelectorSubject {
  attr: string | null
  className: string | null
  id: string | null
  tag: string | null
}

interface DOMSelector {
  extractSubjects(selector: string, caseSensitive?: boolean): readonly SelectorSubject[]
}

// The copy jsdom itself loads, not one resolved from here.
const fromJsdom = createRequire(createRequire(import.meta.url).resolve('jsdom'))
const { DOMSelector } = fromJsdom('@asamuzakjp/dom-selector') as { DOMSelector: { prototype: DOMSelector } }

const PATCHED = Symbol.for('sonorus.where-prefilter')
export const prototype = DOMSelector.prototype as DOMSelector & { [PATCHED]?: true }

// Pseudo-classes or a pseudo-element without arguments, as after the :where()
// of `:where(.stateLayer:hover)::before`.
const PLAIN_PSEUDOS = /^(?:::?[a-z-]+)*$/

// X of a selector that is `:where(X)` and maybe plain pseudos, else null.
function whereOnly(selector: string): string | null {
  if (!selector.startsWith(':where(')) return null
  const close = closingBracket(selector, ':where('.length - 1)
  if (close < 0 || !PLAIN_PSEUDOS.test(selector.slice(close + 1))) return null
  return selector.slice(':where('.length, close)
}

function closingBracket(text: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function hasNoKey(subject: SelectorSubject) {
  return !subject.attr && !subject.className && !subject.id && !subject.tag
}

// The selectors of a list, split at the commas outside brackets and strings.
export function splitSelectorList(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

if (!prototype[PATCHED]) {
  const extract = prototype.extractSubjects
  prototype.extractSubjects = function (selector, caseSensitive) {
    const subjects = extract.call(this, selector, caseSensitive)
    if (!subjects.some(hasNoKey)) return subjects
    const selectors = splitSelectorList(selector)
    if (selectors.length !== subjects.length) return subjects
    return Object.freeze(subjects.map((subject, i) => {
      if (!hasNoKey(subject)) return subject
      const where = whereOnly(selectors[i])
      if (where === null) return subject
      // A list inside :where() matches through any of its selectors: only a
      // single one gives keys every match has.
      const inner = extract.call(this, where, caseSensitive)
      return inner.length === 1 ? inner[0] : subject
    }))
  }
  prototype[PATCHED] = true
}
