import { cx } from '../../styles/cx'
import styles from './Kbd.module.css'

export type KbdOs = 'mac' | 'other'

const currentOs = (): KbdOs => (/mac/i.test(navigator.platform) ? 'mac' : 'other')

const MODIFIERS: Record<string, Record<KbdOs, string>> = {
  mod: { mac: '⌘', other: 'Ctrl' },
  shift: { mac: '⇧', other: 'Shift' },
  alt: { mac: '⌥', other: 'Alt' },
}

const keyLabel = (key: string, os: KbdOs) => MODIFIERS[key]?.[os] ?? key

interface KbdProps {
  // Modifiers are written mod, shift and alt: ['mod', 'K'].
  keys: string[]
  os?: KbdOs
  className?: string
}

// A shortcut hint: "Ctrl K" on Linux and Windows, "⌘K" on macOS.
export function Kbd({ keys, os = currentOs(), className }: KbdProps) {
  const labels = keys.map(key => keyLabel(key, os))
  return <kbd className={cx(styles.kbd, className)}>{labels.join(os === 'mac' ? '' : ' ')}</kbd>
}
