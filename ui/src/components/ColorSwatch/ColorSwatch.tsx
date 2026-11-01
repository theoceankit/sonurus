import * as RadioGroup from '@radix-ui/react-radio-group'
import type { SpeakerColor } from '../../styles/speaker-colors'
import styles from './ColorSwatch.module.css'

interface ColorSwatchProps {
  color: SpeakerColor
  label: string
  disabled?: boolean
}

// One colour to choose; lives inside ColorPicker, which acts as a radio group.
export function ColorSwatch({ color, label, disabled }: ColorSwatchProps) {
  return (
    <RadioGroup.Item className={styles.colorSwatch} value={String(color)} aria-label={label} disabled={disabled}>
      <span className={styles.dot} style={{ background: `var(--color-speaker-${color}-mid)` }} />
    </RadioGroup.Item>
  )
}
