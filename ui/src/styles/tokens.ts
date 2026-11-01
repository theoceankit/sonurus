export interface Token {
  name: string
  value: string
}

export interface Tokens {
  palette: Token[]
  scale: Token[]
  type: Token[]
  light: Token[]
  dark: Token[]
}

const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/g

const declarations = (css: string): Token[] =>
  [...css.matchAll(DECLARATION)].map(([, name, value]) => ({ name, value: value.trim() }))

// Reads tokens.css by its layout: the :root block with the three commented
// layers, then one block per theme.
export function parseTokens(css: string): Tokens {
  const lightAt = css.indexOf("[data-theme='light']")
  const darkAt = css.indexOf("[data-theme='dark']")
  const scaleAt = css.indexOf('/* Scale */')
  const typeAt = css.indexOf('/* Type */')
  return {
    palette: declarations(css.slice(css.indexOf('/* Palette */'), scaleAt)),
    scale: declarations(css.slice(scaleAt, typeAt)),
    type: declarations(css.slice(typeAt, lightAt)),
    light: declarations(css.slice(lightAt, darkAt)),
    dark: declarations(css.slice(darkAt)),
  }
}
