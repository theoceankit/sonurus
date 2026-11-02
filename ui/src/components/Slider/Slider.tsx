import * as RadixSlider from '@radix-ui/react-slider'
import styles from './Slider.module.css'

interface SliderProps {
  // There is no visible text, so this is what assistive technology reads.
  label: string
  value: number
  onChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.02, disabled }: SliderProps) {
  return (
    <RadixSlider.Root
      className={styles.slider}
      orientation="vertical"
      value={[value]}
      onValueChange={([next]) => onChange?.(next)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <RadixSlider.Track className={styles.track}>
        <RadixSlider.Range className={styles.range} />
      </RadixSlider.Track>
      <RadixSlider.Thumb className={styles.thumb} aria-label={label} />
    </RadixSlider.Root>
  )
}
