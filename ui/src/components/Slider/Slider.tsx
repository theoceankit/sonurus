import * as RadixSlider from '@radix-ui/react-slider'
import { cx } from '../../styles/cx'
import styles from './Slider.module.css'

export type SliderMark = { value: number; label: string }

interface SliderProps {
  // There is no visible text, so this is what assistive technology reads.
  label: string
  value: number
  onChange?: (value: number) => void
  // The value where the pointer let go or a key was released: for what is costly to apply.
  onCommit?: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  // Vertical is the volume of the player; horizontal fills the width it is given.
  orientation?: 'vertical' | 'horizontal'
  // Labels under a horizontal track at these values.
  marks?: readonly SliderMark[]
  // What assistive technology reads for the value, when the number alone says too little.
  valueText?: (value: number) => string
}

export function Slider({
  label, value, onChange, onCommit, min = 0, max = 1, step = 0.02, disabled, orientation = 'vertical', marks, valueText,
}: SliderProps) {
  const slider = (
    <RadixSlider.Root
      className={cx(styles.slider, styles[orientation])}
      orientation={orientation}
      value={[value]}
      onValueChange={([next]) => onChange?.(next)}
      onValueCommit={([next]) => onCommit?.(next)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <RadixSlider.Track className={styles.track}>
        <RadixSlider.Range className={styles.range} />
      </RadixSlider.Track>
      <RadixSlider.Thumb className={styles.thumb} aria-label={label} aria-valuetext={valueText?.(value)} />
    </RadixSlider.Root>
  )
  if (orientation === 'vertical' || !marks?.length) return slider
  const at = (mark: number) => `${((mark - min) / (max - min)) * 100}%`
  return (
    <div className={cx(styles.withMarks, disabled && styles.marksDisabled)}>
      {slider}
      <div className={styles.marks} aria-hidden>
        {marks.map(mark => {
          const edge = mark.value === min ? 'start' : mark.value === max ? 'end' : undefined
          return (
            <span key={mark.value} className={styles.mark} data-edge={edge} style={edge ? undefined : { left: at(mark.value) }}>
              {mark.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
