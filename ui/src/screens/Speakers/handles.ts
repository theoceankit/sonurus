import type { Speaker } from '../../api/types'

// Speaker handles as the UI checks them before it sends one. The backend makes them and
// has the last word; the rules here are the same, so a refusal is rare.

const VALID = /^[a-z0-9][a-z0-9._-]{0,31}$/

export const HANDLE_RULE = 'Use lowercase Latin letters, digits, dots, hyphens and underscores, up to 32, starting with a letter or a digit.'

// What the user typed, as a handle is kept: no spaces around, no leading @, lowercase.
export const normalizeHandle = (text: string) => text.trim().replace(/^@+/, '').trim().toLowerCase()

// What a handle field shows as it is typed: lowercase, and the @ is the field's own.
export const typedHandle = (text: string) => text.replace(/^\s*@+/, '').toLowerCase()

// Why the handle cannot be saved, or undefined: not a handle, or another speaker's.
export function handleProblem(text: string, others: readonly Pick<Speaker, 'name' | 'handle'>[]): string | undefined {
  const handle = normalizeHandle(text)
  if (!VALID.test(handle)) return HANDLE_RULE
  const owner = others.find(speaker => speaker.handle?.toLowerCase() === handle)
  return owner ? `@${handle} is taken by ${owner.name ?? 'another speaker'}.` : undefined
}

// A refusal of the backend that is about the handle, to show under the handle field.
export const isHandleRefusal = (error: unknown) =>
  typeof (error as { code?: unknown } | null)?.code === 'string' && (error as { code: string }).code.startsWith('handle_')
