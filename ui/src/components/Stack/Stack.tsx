import type { ComponentPropsWithRef, ElementType } from 'react'
import { ALIGN, JUSTIFY, spacingStyle, type Align, type Justify, type SpacingProps } from '../../styles/space'
import styles from './Stack.module.css'

type StackProps<T extends ElementType> = SpacingProps & {
  as?: T
  align?: Align
  justify?: Justify
} & Omit<ComponentPropsWithRef<T>, 'as' | 'align' | keyof SpacingProps>

// Lays its children out in a column, with spacing only from the scale.
export function Stack<T extends ElementType = 'div'>({
  as, gap, padding, paddingX, paddingY, paddingTop, paddingBottom, align, justify, className, style, ...props
}: StackProps<T>) {
  const Element: ElementType = as ?? 'div'
  return (
    <Element
      className={[styles.stack, className].filter(Boolean).join(' ')}
      style={{
        ...spacingStyle({ gap, padding, paddingX, paddingY, paddingTop, paddingBottom }),
        alignItems: align && ALIGN[align],
        justifyContent: justify && JUSTIFY[justify],
        ...style,
      }}
      {...props}
    />
  )
}
