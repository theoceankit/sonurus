import { formatClock } from '../../media/timeline'
import type { ExportFormat } from '../../platform/electron-api'
import type { TranscriptTurn } from './transcript'

export interface ExportSource {
  title: string
  language: string
  turns: readonly TranscriptTurn[]
  // The note as Markdown, null for a recording without one. Left out, notes are not exported.
  note?: string | null
}

export interface ExportOptions {
  timestamps: boolean
  speakers: boolean
}

const blocks = (...parts: (string | null | undefined | false)[]) => `${parts.filter(Boolean).join('\n\n')}\n`

function exportText({ title, turns, note }: ExportSource, { timestamps, speakers }: ExportOptions): string {
  const body = turns.map(turn => {
    const head = [speakers && turn.speaker.name, timestamps && formatClock(turn.start)].filter(Boolean).join(' ')
    return [...(head ? [head] : []), ...turn.segments.map(segment => segment.text)].join('\n')
  })
  return blocks(title, ...body, note && `Notes\n\n${note}`)
}

// A paragraph of Markdown ends at an empty line: one line each would run together.
function exportMarkdown({ title, turns, note }: ExportSource, { timestamps, speakers }: ExportOptions): string {
  const body = turns.flatMap(turn => {
    const head = [speakers && `**${turn.speaker.name}**`, timestamps && `[${formatClock(turn.start)}]`].filter(Boolean).join(' ')
    return [...(head ? [head] : []), ...turn.segments.map(segment => segment.text)]
  })
  return blocks(`# ${title}`, ...body, note && `## Notes\n\n${note}`)
}

// A switched-off option takes its fields out; "note" is there only with notes on.
function exportJson({ title, language, turns, note }: ExportSource, { timestamps, speakers }: ExportOptions): string {
  const segments = turns.flatMap(turn => turn.segments.map(segment => ({
    ...(timestamps && { start: segment.start, end: segment.end }),
    ...(speakers && { speaker: turn.speaker.name }),
    text: segment.text,
  })))
  return `${JSON.stringify({ title, language, segments, ...(note !== undefined && { note }) }, null, 2)}\n`
}

// Every format at once: which one is written depends on the name picked in the save dialog.
export function exportContents(source: ExportSource, options: ExportOptions): Record<ExportFormat, string> {
  return {
    txt: exportText(source, options),
    md: exportMarkdown(source, options),
    json: exportJson(source, options),
  }
}
