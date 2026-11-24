import type { JSONContent } from '@tiptap/react'
import { formatClock } from '../../media/timeline'
import type { ExportFormat, ExportSpeakerLabel } from '../../platform/electron-api'
import type { TranscriptTurn, TurnSpeaker } from './transcript'

export interface ExportSource {
  title: string
  language: string
  turns: readonly TranscriptTurn[]
  // False for a recording transcribed without speakers: its paragraphs go alone, with
  // no turn heads, and JSON has speaker null.
  diarized?: boolean
  // The note as Markdown, null for a recording without one. Left out, notes are not exported.
  note?: string | null
}

export interface ExportOptions {
  timestamps: boolean
  speakers: boolean
  // By name unless asked for the handle.
  speakerLabel?: ExportSpeakerLabel
}

// Only a named speaker has a handle: Unknown speaker N and Unassigned stay as they are.
const labelOf = (speaker: TurnSpeaker, as: ExportSpeakerLabel = 'name') => (as === 'handle' && speaker.handle ? `@${speaker.handle}` : speaker.name)

const blocks = (...parts: (string | null | undefined | false)[]) => `${parts.filter(Boolean).join('\n\n')}\n`

function exportText({ title, turns, note, diarized = true }: ExportSource, { timestamps, speakers, speakerLabel }: ExportOptions): string {
  const body = turns.map(turn => {
    const head = diarized && [speakers && labelOf(turn.speaker, speakerLabel), timestamps && formatClock(turn.start)].filter(Boolean).join(' ')
    return [...(head ? [head] : []), ...turn.segments.map(segment => segment.text)].join('\n')
  })
  return blocks(title, ...body, note && `Notes\n\n${note}`)
}

// A paragraph of Markdown ends at an empty line: one line each would run together.
function exportMarkdown({ title, turns, note, diarized = true }: ExportSource, { timestamps, speakers, speakerLabel }: ExportOptions): string {
  const body = turns.flatMap(turn => {
    const head = diarized && [speakers && `**${labelOf(turn.speaker, speakerLabel)}**`, timestamps && `[${formatClock(turn.start)}]`].filter(Boolean).join(' ')
    return [...(head ? [head] : []), ...turn.segments.map(segment => segment.text)]
  })
  return blocks(`# ${title}`, ...body, note && `# Notes\n\n${note}`)
}

// A switched-off option takes its fields out, speaker is null without speakers; "note" is there only with notes on.
function exportJson({ title, language, turns, note, diarized = true }: ExportSource, { timestamps, speakers, speakerLabel }: ExportOptions): string {
  const segments = turns.flatMap(turn => turn.segments.map(segment => ({
    ...(timestamps && { start: segment.start, end: segment.end }),
    ...(speakers && { speaker: diarized ? labelOf(turn.speaker, speakerLabel) : null }),
    text: segment.text,
  })))
  return `${JSON.stringify({ title, language, segments, ...(note !== undefined && { note }) }, null, 2)}\n`
}

// In Markdown the note stands under its own "# Notes", so its headings go one level below it.
export function headingsBelowNotes(node: JSONContent): JSONContent {
  return {
    ...node,
    ...(node.type === 'heading' && { attrs: { ...node.attrs, level: (node.attrs?.level ?? 1) + 1 } }),
    ...(node.content && { content: node.content.map(headingsBelowNotes) }),
  }
}

const BUILDERS: Record<ExportFormat, (source: ExportSource, options: ExportOptions) => string> = {
  txt: exportText,
  md: exportMarkdown,
  json: exportJson,
}

export const exportContent = (format: ExportFormat, source: ExportSource, options: ExportOptions) => BUILDERS[format](source, options)
