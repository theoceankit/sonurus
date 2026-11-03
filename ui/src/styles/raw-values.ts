export type RawValueKind = 'color' | 'length' | 'palette' | 'motion'

export interface RawValue {
  line: number
  property: string
  value: string
  kind: RawValueKind
}

const EXEMPTION = /\/\*\s*raw-value:\s*\S.*?\*\//
const COMMENT = /\/\*[\s\S]*?\*\//g
const DECLARATION = /([a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*(?=;|\})/g

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/
const NAMED_COLOR = /\b(?:black|white|gray|grey|red|green|blue|orange|yellow|purple|pink|brown)\b/i
const SPACING_PROPERTY = /^(?:(?:margin|padding|scroll-margin|scroll-padding|inset)(?:-[a-z-]+)?|gap|row-gap|column-gap|top|right|bottom|left)$/
const LENGTH = /(?<![\w-])-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|ch|ex)\b/
const MOTION_PROPERTY = /^(?:transition|animation)(?:-[a-z-]+)?$/
const RAW_MOTION = /(?<![\w-])\d*\.?\d+m?s\b|\bcubic-bezier\(|\bsteps\(|\bease(?:-in|-out|-in-out)?\b|(?<![\w-])all\b/
const OFFSET_PROPERTY = /^(?:scale|translate)$/
const RAW_OFFSET = /(?<![\w-])-?\d*\.?\d+(?![\d.%])/

const blankKeepingLines = (text: string) => text.replace(/[^\n]/g, ' ')

// Finds values in a component's CSS that should come from the tokens. A
// `/* raw-value: why */` comment on the line before a declaration exempts it.
export function findRawValues(css: string, palette: ReadonlySet<string>): RawValue[] {
  const lines = css.split('\n')
  const exempt = (line: number) => EXEMPTION.test(lines[line - 2] ?? '')
  const source = css.replace(COMMENT, blankKeepingLines)
  const found: RawValue[] = []

  for (const match of source.matchAll(DECLARATION)) {
    const [, property, value] = match
    const line = source.slice(0, match.index + match[0].indexOf(property)).split('\n').length
    if (exempt(line)) continue
    const report = (kind: RawValueKind) => found.push({ line, property, value, kind })

    const names = [...value.matchAll(/--[\w-]+/g)].map(m => m[0])
    if (names.some(name => palette.has(name))) report('palette')

    // Token names and file paths are not values: --gray-100 is not "gray".
    const bare = value.replace(/--[\w-]+/g, '').replace(/url\([^)]*\)/g, '')
    if (COLOR_LITERAL.test(bare) || NAMED_COLOR.test(bare)) report('color')
    if (SPACING_PROPERTY.test(property) && LENGTH.test(bare)) report('length')
    if (MOTION_PROPERTY.test(property) && RAW_MOTION.test(bare)) report('motion')
    if (OFFSET_PROPERTY.test(property) && RAW_OFFSET.test(bare.replace(/(?<![\w-])0(?![\d.])/g, ''))) report('motion')
  }
  return found
}

const INLINE_STYLE = /style=\{\{([\s\S]*?)\}\}/g

// The same rule for inline styles in TSX, where only literals can be told apart.
export function findRawInlineStyles(tsx: string): string[] {
  return [...tsx.matchAll(INLINE_STYLE)]
    .map(match => match[1])
    .filter(style => COLOR_LITERAL.test(style) || /\b\d*\.?\d+(?:px|rem|em)\b/.test(style))
}
