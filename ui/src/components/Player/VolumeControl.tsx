import * as Popover from '@radix-ui/react-popover'
import { cx } from '../../styles/cx'
import { IconButton } from '../IconButton/IconButton'
import { Slider } from '../Slider/Slider'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './Player.module.css'

interface VolumeControlProps {
  volume: number
  onChange: (volume: number) => void
  disabled?: boolean
  // For a story: the popup without a click.
  defaultOpen?: boolean
}

// The distance from the button, the same for the popups of the player.
export const POPUP_OFFSET = 8

export function VolumeControl({ volume, onChange, disabled, defaultOpen }: VolumeControlProps) {
  return (
    <Popover.Root defaultOpen={defaultOpen}>
      <Tooltip text="Volume">
        <Popover.Trigger asChild>
          <IconButton icon="volume" label="Volume" disabled={disabled} className={cx(volume === 0 && styles.muted)} />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content side="top" sideOffset={POPUP_OFFSET} className={styles.volume}>
          <Slider label="Volume level" value={volume} onChange={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
