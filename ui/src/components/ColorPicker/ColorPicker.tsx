import * as RadioGroup from '@radix-ui/react-radio-group'
import { useId } from 'react'
import { SPEAKER_COLORS, type SpeakerColor } from '../../styles/speaker-colors'
import { ColorSwatch } from '../ColorSwatch/ColorSwatch'
import { Stack } from '../Stack/Stack'
import styles from './ColorPicker.module.css'

const NAMES: Record<SpeakerColor, string> = { 1: 'Blue', 2: 'Teal', 3: 'Lilac', 4: 'Tangerine', 5: 'Rose', 6: 'Gray' }

interface ColorPickerProps {
  value: SpeakerColor
  onValueChange: (color: SpeakerColor) => void
  // Without a label, name the group with aria-label.
  label?: string
  'aria-label'?: string
  disabled?: boolean
}

// The speaker colour choice: exactly one of six, and arrow keys move the choice.
export function ColorPicker({ value, onValueChange, label, 'aria-label': ariaLabel, disabled }: ColorPickerProps) {
  const labelId = useId()
  return (
    <Stack gap={1}>
      {label && <span id={labelId} className={styles.label}>{label}</span>}
      <RadioGroup.Root
        className={styles.swatches}
        orientation="horizontal"
        value={String(value)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={label ? labelId : undefined}
        onValueChange={next => onValueChange(Number(next) as SpeakerColor)}
      >
        {SPEAKER_COLORS.map(color => <ColorSwatch key={color} color={color} label={NAMES[color]} />)}
      </RadioGroup.Root>
    </Stack>
  )
}
