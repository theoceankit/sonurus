import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import { Menu, MenuAction } from '../Menu/Menu'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './SourceToggle.module.css'

export type DeviceOption = { value: string; label: string }

interface SourceToggleProps {
  icon: IconName
  // Microphone, System audio.
  name: string
  on: boolean
  onToggle: () => void
  devices: readonly DeviceOption[]
  device: string | null
  onDeviceChange: (device: string) => void
  // Nothing of it can be changed, such as while a recording runs.
  disabled?: boolean
  // Why this source cannot record at all; the button stays off and says so.
  unavailable?: string
}

// A source of a live recording, as in a call app: the button turns it on and off for
// the recording, the arrow picks its device. The device shows in the tooltip and the
// menu only, so the button keeps to one line.
export function SourceToggle({ icon, name, on, onToggle, devices, device, onDeviceChange, disabled, unavailable }: SourceToggleProps) {
  const active = on && !unavailable
  const deviceLabel = devices.find(option => option.value === device)?.label
  const hint = unavailable ?? (active ? `${deviceLabel ?? name}. Click to turn off` : 'Off. Click to record')
  const blocked = disabled || !!unavailable
  return (
    <div className={cx(styles.sourceToggle, active && styles.on, blocked && styles.blocked)}>
      <Tooltip text={hint} placement="below">
        <button
          type="button"
          aria-pressed={active}
          aria-disabled={blocked || undefined}
          className={styles.main}
          onClick={() => { if (!blocked) onToggle() }}
        >
          <Icon name={icon} />
          <span className={styles.name}>{name}</span>
        </button>
      </Tooltip>
      <Menu
        align="end"
        trigger={(
          <button type="button" aria-label={`${name} device`} className={styles.arrow} disabled={blocked || devices.length === 0}>
            <Icon name="chevron-down" size={12} />
          </button>
        )}
      >
        {devices.map(option => (
          <MenuAction key={option.value} selected={option.value === device} onSelect={() => onDeviceChange(option.value)}>
            {option.label}
          </MenuAction>
        ))}
      </Menu>
    </div>
  )
}
