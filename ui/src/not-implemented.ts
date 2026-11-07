import type { SyntheticEvent } from 'react'
import { toast } from './components/Toast/toast-store'

// ── Unimplemented controls ─────────────────────────────────────────────────────
// A control whose feature does not exist yet stays visible, dimmed and
// clickable: activating it only shows NOT_IMPLEMENTED_TOAST and never reaches the
// control's own handlers, so its state and the saved settings do not change.
//
// NOT_IMPLEMENTED lists every such control, and a control is marked where it is
// rendered: <Button {...markNotImplemented('titlebar.share')}>. When a feature
// lands, remove its id here and the call (not-implemented.test.ts fails if only
// one of the two is removed).

export const NOT_IMPLEMENTED = [
  'alignment.open-settings',
  'choose-speaker.invited',
  'choose-speaker.recently-added',
  'home.settings',
  'import.open-settings',
  'inspector.chapters',
  'inspector.notes',
  'new-speaker.email',
  'new-speaker.handle',
  'new-transcription.diarize',
  'new-transcription.open-settings',
  'titlebar.back',
  'titlebar.forward',
  'titlebar.search',
  'titlebar.settings',
  'titlebar.speakers',
  'transcript.export',
  'transcript.folder',
  'transcript.highlight',
  'transcript.pin',
] as const satisfies readonly string[]

export type NotImplementedId = (typeof NOT_IMPLEMENTED)[number]

export const NOT_IMPLEMENTED_TOAST = 'Not available yet'

const stop = (event: SyntheticEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

// Radix does not wait for a click: tabs switch on mousedown and on focus, menus
// act on pointerup and on the keydown of Enter and Space. So each of these stops
// on the way down, before the control or anything inside a marked container.
// Stopping focus does not stop the browser from moving it.
export function notImplementedProps(id: string) {
  return {
    'data-not-implemented': id,
    'aria-disabled': true,
    onPointerDownCapture: stop,
    onPointerUpCapture: stop,
    onMouseDownCapture: stop,
    onFocusCapture: (event: SyntheticEvent) => event.stopPropagation(),
    onKeyDownCapture: (event: SyntheticEvent) => {
      const { key } = event.nativeEvent as KeyboardEvent
      if (key === 'Enter' || key === ' ') event.stopPropagation()
    },
    onClickCapture: (event: SyntheticEvent) => {
      stop(event)
      toast({ message: NOT_IMPLEMENTED_TOAST })
    },
  }
}

export const markNotImplemented = (id: NotImplementedId) => notImplementedProps(id)

export interface SourceFile {
  path: string
  text: string
}

const CALL = /markNotImplemented\(/g
const LITERAL_CALL = /markNotImplemented\(\s*(['"`])([^'"`]+)\1\s*\)/g

// What the list and the calls disagree on. Stories and tests do not count.
export function findNotImplementedProblems(sources: SourceFile[], registered: readonly string[]): string[] {
  const problems: string[] = []
  const calls = new Map<string, string[]>()
  for (const { path, text } of sources) {
    if (/\.(test|stories)\.tsx?$/.test(path) || /(^|\/)not-implemented\.ts$/.test(path)) continue
    const literal = [...text.matchAll(LITERAL_CALL)]
    if (literal.length !== [...text.matchAll(CALL)].length) problems.push(`${path}: an id that is not a plain string`)
    for (const match of literal) calls.set(match[2], [...(calls.get(match[2]) ?? []), path])
    if (/not available yet/i.test(text)) problems.push(`${path}: its own "not available" text`)
  }
  for (const id of registered) {
    const hits = calls.get(id) ?? []
    if (hits.length !== 1) problems.push(`${id}: ${hits.length} calls${hits.length ? `, in ${hits.join(', ')}` : ''}`)
  }
  for (const [id, hits] of calls) {
    if (!registered.includes(id)) problems.push(`${id}: not in the list, called in ${hits.join(', ')}`)
  }
  return problems
}
