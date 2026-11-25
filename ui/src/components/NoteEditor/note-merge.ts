import type { JSONContent } from '@tiptap/react'
import { isEmptyNote } from './note-content'

// A note merged from the version both sides started from, the one typed here and the
// one written elsewhere. conflicts counts the places where both sides changed the same
// block in different ways: each of them keeps both versions, theirs first.
export interface NoteMerge {
  doc: JSONContent
  conflicts: number
}

type Doc = JSONContent | null | undefined

// Blocks that hold blocks: a merge goes inside them. A paragraph or a heading is
// merged whole: the same one changed on both sides is a conflict.
const CONTAINERS = new Set(['doc', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'])
const ITEMS = new Set(['listItem', 'taskItem'])

// One form for comparing: keys in order, attributes left null dropped.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]): [string, unknown] => [k, k === 'attrs' ? canonicalAttrs(v) : canonical(v)])
    .filter(([k, v]) => k !== 'attrs' || v !== undefined)
  return Object.fromEntries(entries)
}

function canonicalAttrs(attrs: unknown) {
  if (!attrs || typeof attrs !== 'object') return undefined
  const kept = Object.entries(attrs as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined)
  return kept.length > 0 ? canonical(Object.fromEntries(kept)) : undefined
}

const key = (node: JSONContent) => JSON.stringify(canonical(node))

const blocks = (doc: Doc): JSONContent[] => (isEmptyNote(doc) ? [] : doc!.content ?? [])

// The same note: no note, an empty document and one empty paragraph are one thing.
export function sameNote(a: Doc, b: Doc): boolean {
  return JSON.stringify(blocks(a).map(canonical)) === JSON.stringify(blocks(b).map(canonical))
}

// What a side did to a stretch of base: blocks start to end (end excluded) replaced
// by nodes. A block edited is one block replaced by its new version; one added is an
// empty stretch with nodes; one removed, a stretch with no nodes.
interface Hunk {
  start: number
  end: number
  nodes: JSONContent[]
}

function hunksOf(base: JSONContent[], baseKeys: string[], other: JSONContent[]): Hunk[] {
  const otherKeys = other.map(key)
  const n = base.length
  const m = other.length
  // Longest common subsequence, from the ends.
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = baseKeys[i] === otherKeys[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const hunks: Hunk[] = []
  let open: Hunk | null = null
  const close = () => {
    if (open) hunks.push(open)
    open = null
  }
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && baseKeys[i] === otherKeys[j]) {
      close()
      i++
      j++
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      open ??= { start: i, end: i, nodes: [] }
      open.end = ++i
    } else {
      open ??= { start: i, end: i, nodes: [] }
      open.nodes.push(other[j++])
    }
  }
  close()
  return hunks
}

// The stretch from to end of base as a side's hunks within it leave it.
function applied(base: JSONContent[], hunks: Hunk[], from: number, to: number) {
  const out: JSONContent[] = []
  let at = from
  for (const hunk of hunks) {
    out.push(...base.slice(at, hunk.start), ...hunk.nodes)
    at = hunk.end
  }
  out.push(...base.slice(at, to))
  return out
}

// Two changes touch the same blocks, or add at the same place. One that only borders
// on the other does not: an edit and a paragraph added right after it are two changes.
function overlaps(start: number, end: number, hunk: Hunk) {
  if (hunk.start < end && start < hunk.end) return true
  if (start === end && hunk.start === hunk.end) return start === hunk.start
  if (start === end) return hunk.start < start && start < hunk.end
  if (hunk.start === hunk.end) return start < hunk.start && hunk.start < end
  return false
}

function mergeAttrs(base: JSONContent['attrs'], local: JSONContent['attrs'], remote: JSONContent['attrs']) {
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(local ?? {}), ...Object.keys(remote ?? {})])
  if (keys.size === 0) return undefined
  const merged: Record<string, unknown> = {}
  for (const k of keys) {
    const was = base?.[k]
    const mine = local?.[k]
    merged[k] = JSON.stringify(mine) === JSON.stringify(was) ? remote?.[k] : mine
  }
  return merged
}

// Both sides changed one block of base into a block of its own type, one that holds
// blocks: merge inside it.
function mergeable(base: JSONContent[], local: JSONContent[], remote: JSONContent[]) {
  if (base.length !== 1 || local.length !== 1 || remote.length !== 1) return false
  const type = base[0].type ?? ''
  return CONTAINERS.has(type) && local[0].type === type && remote[0].type === type
}

interface Group {
  start: number
  end: number
  mine: Hunk[]
  theirs: Hunk[]
}

function mergeChildren(base: JSONContent[], local: JSONContent[], remote: JSONContent[]): { content: JSONContent[]; conflicts: number } {
  const baseKeys = base.map(key)
  const all = [
    ...hunksOf(base, baseKeys, local).map(hunk => ({ hunk, mine: true })),
    ...hunksOf(base, baseKeys, remote).map(hunk => ({ hunk, mine: false })),
  ].sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end)
  // Changes that overlap, from either side, are decided together.
  const groups: Group[] = []
  for (const { hunk, mine } of all) {
    const last = groups.at(-1)
    if (last && overlaps(last.start, last.end, hunk)) {
      last.end = Math.max(last.end, hunk.end)
      last.start = Math.min(last.start, hunk.start)
      ;(mine ? last.mine : last.theirs).push(hunk)
    } else {
      groups.push({ start: hunk.start, end: hunk.end, mine: mine ? [hunk] : [], theirs: mine ? [] : [hunk] })
    }
  }
  const content: JSONContent[] = []
  let conflicts = 0
  let at = 0
  for (const group of groups) {
    content.push(...base.slice(at, group.start))
    at = group.end
    const was = base.slice(group.start, group.end)
    const a = applied(base, group.mine, group.start, group.end)
    const b = applied(base, group.theirs, group.start, group.end)
    if (group.theirs.length === 0 || key({ content: a }) === key({ content: b })) content.push(...a)
    else if (group.mine.length === 0) content.push(...b)
    // Removed on one side, changed on the other: the change stays, nothing is lost.
    else if (b.length === 0 && was.length > 0) content.push(...a)
    else if (a.length === 0 && was.length > 0) content.push(...b)
    else if (mergeable(was, a, b)) {
      const inner = mergeChildren(was[0].content ?? [], a[0].content ?? [], b[0].content ?? [])
      if (inner.conflicts > 0 && ITEMS.has(was[0].type ?? '')) {
        // An item in two versions is two items, not one with both texts.
        content.push(...b, ...a)
        conflicts++
      } else {
        const attrs = mergeAttrs(was[0].attrs, a[0].attrs, b[0].attrs)
        content.push({ ...b[0], ...(attrs && { attrs }), content: inner.content })
        conflicts += inner.conflicts
      }
    } else {
      content.push(...b, ...a)
      conflicts++
    }
  }
  content.push(...base.slice(at))
  return { content, conflicts }
}

// Merges two versions of a note made from the same one, block by block, inside lists
// and quotes: what only one side changed is taken from it, the same change once, and
// a block both changed differently is kept in both versions. Null is no note.
export function mergeNotes(base: Doc, local: Doc, remote: Doc): NoteMerge {
  const { content, conflicts } = mergeChildren(blocks(base), blocks(local), blocks(remote))
  return { doc: { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }, conflicts }
}
