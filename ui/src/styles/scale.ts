import css from './tokens.css?raw'
import { parseTokens } from './tokens'

const scale = parseTokens(css).scale

// A value of the scale that a script needs, in px or ms, from the same tokens as the styles.
export function scaleValue(name: string): number {
  const token = scale.find(candidate => candidate.name === name)
  if (!token) throw new Error(`No token ${name}`)
  return parseFloat(token.value)
}
