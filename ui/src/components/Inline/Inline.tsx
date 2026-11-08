import type { ComponentPropsWithRef, ElementType } from 'react'
import { ALIGN, JUSTIFY, spacingStyle, type Align, type Justify, type SpacingProps } from '../../styles/space'
import styles from './Inline.module.css'

type InlineProps<T extends ElementType> = SpacingProps & {
  as?: T
  align?: Align
  justify?: Justify
  wrap?: boolean
} & Omit<ComponentPropsWithRef<T>, 'as' | 'align' | 'wrap' | keyof SpacingProps>

// Lays its children out in a row, with spacing only from the scale.
export function Inline<T extends ElementType = 'div'>({
  as, gap, padding, paddingX, paddingY, paddingTop, paddingBottom, align = 'center', justify, wrap, className, style, ...props
}: InlineProps<T>) {
  const Element: ElementType = as ?? 'div'
  return (
    <Element
      className={[styles.inline, className].filter(Boolean).join(' ')}
      style={{
        ...spacingStyle({ gap, padding, paddingX, paddingY, paddingTop, paddingBottom }),
        alignItems: ALIGN[align],
        justifyContent: justify && JUSTIFY[justify],
        flexWrap: wrap ? 'wrap' : undefined,
        ...style,
      }}
      {...props}
    />
  )
}
