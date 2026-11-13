import type { HandleFormat } from '../types'

// The fixture backend's speaker handles: the same rules as app/services/speaker_handle.py,
// so stories and tests see what the app shows. The app itself never makes a handle:
// the backend does.

export const MAX_HANDLE_LENGTH = 32

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'i', є: 'ye', ґ: 'g', ў: 'u',
}
const LATIN: Record<string, string> = { ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' }

const transliterate = (text: string) => [...text.toLowerCase()]
  .map(char => CYRILLIC[char] ?? LATIN[char] ?? char.normalize('NFKD').replace(/\p{M}/gu, ''))
  .join('')

const cut = (handle: string, length: number) => handle.slice(0, length).replace(/[._-]+$/, '')

export function baseHandle(name: string, format: HandleFormat = 'first.last'): string {
  const words = transliterate(name).split(/\s+/).map(word => word.replace(/[^a-z0-9]/g, '')).filter(Boolean)
  if (words.length === 0) return 'speaker'
  if (words.length === 1) return cut(words[0], MAX_HANDLE_LENGTH)
  const [first, last] = [words[0], words[words.length - 1]]
  const handle = format === 'f.last' ? `${first[0]}.${last}` : format === 'first.l' ? `${first}.${last[0]}` : `${first}.${last}`
  return cut(handle, MAX_HANDLE_LENGTH)
}

export function uniqueHandle(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(handle => handle.toLowerCase()))
  if (!used.has(base)) return base
  for (let number = 2; ; number++) {
    const suffix = String(number)
    const candidate = cut(base, MAX_HANDLE_LENGTH - suffix.length) + suffix
    if (!used.has(candidate)) return candidate
  }
}
