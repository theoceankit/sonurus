import type { CSSProperties } from 'react'

// Steps of the spacing scale in tokens.css.
export type Space = 'half' | 1 | 2 | 3 | 4 | 5 | 6 | 8

export interface SpacingProps {
  gap?: Space
  padding?: Space
  paddingX?: Space
  paddingY?: Space
}

const space = (step: Space | undefined) => (step === undefined ? undefined : `var(--space-${step})`)

export function spacingStyle({ gap, padding, paddingX, paddingY }: SpacingProps): CSSProperties {
  return {
    gap: space(gap),
    paddingBlock: space(paddingY ?? padding),
    paddingInline: space(paddingX ?? padding),
  }
}

export const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' } as const
export const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' } as const

export type Align = keyof typeof ALIGN
export type Justify = keyof typeof JUSTIFY
