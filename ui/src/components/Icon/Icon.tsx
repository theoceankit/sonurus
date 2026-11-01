import type { IconName } from './icon-names'
import styles from './Icon.module.css'

export type IconSize = 12 | 14 | 16 | 20 | 24

const files = import.meta.glob<string>('../../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true })

const shapes = (name: IconName) => files[`../../assets/icons/${name}.svg`].replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')

interface IconProps {
  name: IconName
  size?: IconSize
  label?: string
  className?: string
}

// The shapes go inline because a stroke width set in CSS cannot reach a file
// used as an image or a mask; the width has to stay 1 px at the small sizes.
export function Icon({ name, size = 16, label, className }: IconProps) {
  return (
    <svg
      className={[styles.icon, styles[`size${size}`], className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: shapes(name) }}
    />
  )
}
