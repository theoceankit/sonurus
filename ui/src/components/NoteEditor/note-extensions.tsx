import { Extension, InputRule, mergeAttributes, Node, type Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { createContext, useContext } from 'react'
import { formatClock } from '../../media/timeline'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { MentionChip } from '../MentionChip/MentionChip'
import { TimecodeChip } from '../TimecodeChip/TimecodeChip'

// A speaker as they are now, for a mention to show; null once deleted.
export type FindSpeaker = (id: string) => { name: string; color: SpeakerColor; photo?: string | null; handle?: string | null } | null

// What the chips in a note need from the screen. Node views render inside the
// editor's own React tree, so a context reaches them.
export interface NoteChipContext {
  findSpeaker: FindSpeaker
  onSeek?: (seconds: number) => void
}

export const NoteChips = createContext<NoteChipContext>({ findSpeaker: () => null })

function TimecodeView({ node, selected }: ReactNodeViewProps) {
  const { onSeek } = useContext(NoteChips)
  const seconds = node.attrs.seconds as number
  return (
    <NodeViewWrapper as="span" data-timecode={seconds}>
      <TimecodeChip seconds={seconds} selected={selected} contentEditable={false} onClick={() => onSeek?.(seconds)} />
    </NodeViewWrapper>
  )
}

// A moment of the recording: one node the cursor goes around, never into.
export const Timecode = Node.create({
  name: 'timecode',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    seconds: { default: 0, parseHTML: element => Number(element.getAttribute('data-timecode')), renderHTML: attrs => ({ 'data-timecode': attrs.seconds }) },
  }),
  parseHTML: () => [{ tag: 'span[data-timecode]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes)],
  // As Copy notes writes it.
  renderText: ({ node }) => `[${formatClock(node.attrs.seconds as number)}]`,
  addNodeView: () => ReactNodeViewRenderer(TimecodeView),
})

function MentionView({ node, selected }: ReactNodeViewProps) {
  const { findSpeaker } = useContext(NoteChips)
  const { kind, id, label } = node.attrs as { kind: string; id: string | null; label: string }
  const speaker = kind === 'speaker' && id ? findSpeaker(id) : null
  return (
    <NodeViewWrapper as="span" data-mention={kind}>
      {kind === 'person'
        ? <MentionChip target={{ kind: 'person', name: label }} selected={selected} />
        : speaker
          ? <MentionChip target={{ kind: 'speaker', ...speaker }} selected={selected} />
          // Deleted: the name it had, as text.
          : <span>{label}</span>}
    </NodeViewWrapper>
  )
}

// A mention keeps who it is: a speaker by id, a person not in the base by name.
export const NoteMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: 'speaker', parseHTML: element => element.getAttribute('data-mention'), renderHTML: attrs => ({ 'data-mention': attrs.kind }) },
    }
  },
  addNodeView: () => ReactNodeViewRenderer(MentionView),
})

// [text](address) typed out becomes a link, as the rest of the Markdown does.
export const NoteLink = Link.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]]+)\]\(([^)\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const [, label, href] = match
          state.tr.replaceWith(range.from, range.to, state.schema.text(label, [this.type.create({ href })]))
        },
      }),
    ]
  },
})

// "- [ ] " as in Obsidian: the list item just made by "- " becomes a checkbox, rather
// than keeping "[ ]" as text. Only an item with nothing before the mark. The item
// leaves its list, which splits around it, and joins a list of checkboxes right
// before it, if there is one.
export const TaskFromListItem = Extension.create({
  name: 'taskFromListItem',
  // Before the checkbox rule of TaskItem, which would put a checkbox list inside the item.
  priority: 1000,
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX]?)\]\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.depth < 3 || $from.index(-1) !== 0) return null
          if ($from.node(-1).type.name !== 'listItem' || $from.node(-2).type.name !== 'bulletList') return null
          const { taskList, taskItem } = state.schema.nodes
          const tr = state.tr.delete(range.from, range.to)
          const $item = tr.doc.resolve(tr.mapping.map(range.from))
          const list = $item.node(-2)
          const listPos = $item.before(-2)
          const index = $item.index(-2)
          const before: PMNode[] = []
          const after: PMNode[] = []
          list.forEach((child, _offset, i) => { if (i < index) before.push(child); else if (i > index) after.push(child) })
          const task = taskList.create(null, taskItem.create({ checked: match[1].toLowerCase() === 'x' }, list.child(index).content))
          const pieces = [...(before.length ? [list.copy(Fragment.from(before))] : []), task, ...(after.length ? [list.copy(Fragment.from(after))] : [])]
          tr.replaceWith(listPos, listPos + list.nodeSize, pieces)
          const taskPos = listPos + (before.length ? pieces[0].nodeSize : 0)
          // Into the checkbox's text: taskList, taskItem, paragraph.
          tr.setSelection(TextSelection.create(tr.doc, taskPos + 3))
          if (tr.doc.resolve(taskPos).nodeBefore?.type === taskList) tr.join(taskPos)
        },
      }),
    ]
  },
})

const keptSelection = new PluginKey<boolean>('keptSelection')

// On while the link window or a menu of the note's bar has the focus, and only then:
// Tiptap's own Selection paints whenever the note has no focus.
export function keepSelection(editor: Editor, keep: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(keptSelection, keep).setMeta('addToHistory', false))
}

// What is selected, painted while it is kept and the note has no focus.
export const KeptSelection = Extension.create<{ className: string }>({
  name: 'keptSelection',
  addOptions: () => ({ className: '' }),
  addProseMirrorPlugins() {
    const { editor, options } = this
    return [
      new Plugin({
        key: keptSelection,
        state: { init: () => false, apply: (tr, kept): boolean => tr.getMeta(keptSelection) ?? kept },
        props: {
          decorations(state) {
            const { selection } = state
            if (!keptSelection.getState(state) || selection.empty || editor.isFocused) return null
            return DecorationSet.create(state.doc, [Decoration.inline(selection.from, selection.to, { class: options.className })])
          },
        },
      }),
    ]
  },
})
