import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { createContext, useContext } from 'react'
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
  renderText: ({ node }) => `[${node.attrs.seconds}]`,
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
