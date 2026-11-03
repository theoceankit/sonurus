import css from './tokens.css?raw'
import { parseTokens } from './tokens'

const scale = parseTokens(css).scale

// A wait that a script keeps, in ms, from the same tokens as the styles.
function delay(name: string): number {
  const token = scale.find(candidate => candidate.name === name)
  if (!token) throw new Error(`No token ${name}`)
  return parseFloat(token.value)
}

// How long the pointer stays on a speaker before it is highlighted, and how long
// after a highlight the next one comes at once.
export const HOVER_DELAY = delay('--delay-hover')
export const HOVER_SKIP = delay('--delay-hover-skip')
