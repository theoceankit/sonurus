import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import { Fragment, NodeRange, Slice } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, findWrapping, liftTarget } from '@tiptap/pm/transform'

// Lists and quotes over the blocks selected. Each step moves the edges of those
// blocks only: what is in them (ticks, items of their own, the cursor) stays, and so
// does what is around them.

export type ListType = 'bulletList' | 'orderedList' | 'taskList'

const ITEM_OF: Record<ListType, string> = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' }
const ITEMS = new Set(Object.values(ITEM_OF))

interface Block {
  node: PMNode
  pos: number
  // The list, for the line with the bullet, the number or the checkbox: an item's
  // first block. A block under it in the item is no item itself.
  list: string | null
}

// The blocks of text selected. Empty paragraphs at either end are not meant, such as
// the one the note keeps after a list, unless nothing else is selected.
function selectedBlocks({ doc, selection }: Pick<EditorState, 'doc' | 'selection'>): Block[] {
  const blocks: Block[] = []
  doc.nodesBetween(selection.from, selection.to, (node, pos, parent, index) => {
    if (!node.isTextblock) return true
    const marked = index === 0 && parent && ITEMS.has(parent.type.name)
    blocks.push({ node, pos, list: marked ? doc.resolve(pos).node(-1).type.name : null })
    return false
  })
  const meant = (block: Block) => block.list !== null || block.node.content.size > 0
  const first = blocks.findIndex(meant)
  if (first < 0) return blocks
  let end = blocks.length
  while (!meant(blocks[end - 1])) end--
  return blocks.slice(first, end)
}

export const canToggleList = (state: EditorState) => selectedBlocks(state).length > 0

// Lit, so a press takes it off.
export function listActive(state: EditorState, type: ListType) {
  const blocks = selectedBlocks(state)
  return blocks.length > 0 && blocks.every(block => block.list === type)
}

// The item with the block at pos gets a list to itself. Returns where that list is.
function ownList(tr: Transaction, pos: number) {
  const $block = tr.doc.resolve(pos)
  const index = $block.index(-1)
  let item = $block.before()
  if (index < $block.node(-1).childCount - 1) tr.split($block.after())
  if (index > 0) {
    tr.split(item)
    item += 2
  }
  return item - 1
}

// The list of one item at pos gives way to the wrappers given, with the content of
// the item in them; with none, the content stands there by itself.
function rewrapItem(tr: Transaction, pos: number, wrappers: NodeType[]) {
  const end = pos + tr.doc.nodeAt(pos)!.nodeSize
  let around = Fragment.empty
  for (const type of [...wrappers].reverse()) around = Fragment.from(type.create(null, around))
  tr.step(new ReplaceAroundStep(pos, end, pos + 2, end - 2, new Slice(around, 0, 0), wrappers.length, true))
}

// A list next to the one just made, of the same type, is the same list.
function joinSameLists(tr: Transaction, pos: number) {
  const list = tr.doc.nodeAt(pos)!
  const after = pos + list.nodeSize
  if (tr.doc.resolve(after).nodeAfter?.type === list.type) tr.join(after)
  if (tr.doc.resolve(pos).nodeBefore?.type === list.type) tr.join(pos)
}

export function toggleListBlocks(tr: Transaction, type: ListType) {
  const { nodes } = tr.doc.type.schema
  const blocks = selectedBlocks(tr)
  const off = blocks.every(block => block.list === type)
  // From the last one, so the places of those before it hold.
  for (const { node, pos, list } of blocks.reverse()) {
    if (off) {
      rewrapItem(tr, ownList(tr, pos), [])
    } else if (list === null) {
      if (node.type !== nodes.paragraph) tr.setNodeMarkup(pos, nodes.paragraph)
      const range = tr.doc.resolve(pos).blockRange(tr.doc.resolve(pos + node.nodeSize))!
      tr.wrap(range, [{ type: nodes[type] }, { type: nodes[ITEM_OF[type]] }])
      joinSameLists(tr, pos)
    } else if (list !== type) {
      const own = ownList(tr, pos)
      rewrapItem(tr, own, [nodes[type], nodes[ITEM_OF[type]]])
      joinSameLists(tr, own)
    }
  }
}

// The depth of the quote the position is in, the inner one of two.
function quoteDepth(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'blockquote') return depth
  }
  return null
}

export function quoteActive(state: EditorState) {
  const blocks = selectedBlocks(state)
  return blocks.length > 0 && blocks.every(block => quoteDepth(state.doc, block.pos) !== null)
}

// What a quote would go around. Items are quoted as a whole list, when all of it is selected.
function quoteRange(doc: PMNode, blocks: Block[]): NodeRange | null {
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  let range = doc.resolve(first.pos + 1).blockRange(doc.resolve(last.pos + last.node.nodeSize - 1))
  while (
    range && blocks.length > 1 && range.startIndex === 0 && range.endIndex === range.parent.childCount
    && range.parent.type.name in ITEM_OF
  ) {
    range = new NodeRange(doc.resolve(range.start - 1), doc.resolve(range.end + 1), range.depth - 1)
  }
  return range
}

export function canToggleQuote(state: EditorState) {
  if (quoteActive(state)) return true
  const blocks = selectedBlocks(state)
  if (blocks.length === 0) return false
  const range = quoteRange(state.doc, blocks)
  return range !== null && findWrapping(range, state.schema.nodes.blockquote) !== null
}

// first and last leave their quote. Of a list in it only their items go.
function leaveQuote(tr: Transaction, first: Block, last: Block, depth: number) {
  let from = first.pos
  let to = last.pos
  const $last = tr.doc.resolve(to)
  if ($last.depth > depth + 1 && $last.node(depth + 1).type.name in ITEM_OF && $last.index(depth + 1) < $last.node(depth + 1).childCount - 1) {
    tr.split($last.after(depth + 2))
  }
  const $first = tr.doc.resolve(from)
  if ($first.depth > depth + 1 && $first.node(depth + 1).type.name in ITEM_OF && $first.index(depth + 1) > 0) {
    tr.split($first.before(depth + 2))
    from += 2
    to += 2
  }
  const range = new NodeRange(tr.doc.resolve(from), tr.doc.resolve(to + last.node.nodeSize), depth)
  const target = liftTarget(range)
  if (target !== null) tr.lift(range, target)
}

export function toggleQuoteBlocks(tr: Transaction) {
  const blocks = selectedBlocks(tr)
  if (blocks.length === 0) return
  const depths = blocks.map(block => quoteDepth(tr.doc, block.pos))
  if (depths.every(depth => depth !== null)) {
    const leaving: { start: number; end: number; depth: number; first: Block; last: Block }[] = []
    blocks.forEach((block, i) => {
      const depth = depths[i]!
      const start = tr.doc.resolve(block.pos).before(depth)
      let first = block
      // A quote in a quote that comes off goes along with it.
      while (leaving.length && leaving[leaving.length - 1].start >= start) first = leaving.pop()!.first
      const around = leaving[leaving.length - 1]
      if (around && block.pos < around.end) around.last = block
      else leaving.push({ start, end: start + tr.doc.nodeAt(start)!.nodeSize, depth, first, last: block })
    })
    // Quote by quote, from the last one.
    for (const { first, last, depth } of leaving.reverse()) leaveQuote(tr, first, last, depth)
    return
  }
  const { blockquote } = tr.doc.type.schema.nodes
  const range = quoteRange(tr.doc, blocks)
  const wrapping = range && findWrapping(range, blockquote)
  if (!range || !wrapping) return
  const pos = range.start
  tr.wrap(range, wrapping)
  // A quote among what was selected becomes part of the new one.
  const inner: { from: number; to: number; depth: number }[] = []
  const depth = tr.doc.resolve(pos).depth
  tr.doc.nodeAt(pos)!.forEach((child, offset) => {
    const start = pos + 1 + offset
    if (child.type === blockquote) inner.push({ from: start + 1, to: start + child.nodeSize - 1, depth: depth + 2 })
  })
  for (const quote of inner.reverse()) {
    tr.lift(new NodeRange(tr.doc.resolve(quote.from), tr.doc.resolve(quote.to), quote.depth), quote.depth - 1)
  }
}
