import type { ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { Badge } from '../Badge/Badge'
import { Button } from '../Button/Button'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import { IconButton } from '../IconButton/IconButton'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './ModelRow.module.css'

export type ModelRowState = 'available' | 'downloading' | 'installed' | 'failed'

export type DefaultMark = 'badge' | 'check' | 'tint' | 'radio'

export interface ModelRowProps {
  icon: IconName
  name: string
  // Size and speed: each its own item, without separators.
  meta: readonly string[]
  state: ModelRowState
  // While downloading, from 0 to 100.
  pct?: number
  // Why the last download failed.
  error?: string
  onDownload?: () => void
  onCancel?: () => void
  // Makes an installed model the default; its row is clickable too.
  onUse?: () => void
  // The default: no Use, and the row is marked "Default".
  selected?: boolean
  // How the default is marked; the variants are on the board in Storybook until one is chosen.
  //   badge: a Default badge next to the name
  //   check: a check and Default where Use is on the other rows
  //   tint:  the row tinted, Default under the name
  //   radio: a radio in place of the icon on every installed row, filled on the default
  defaultMark?: DefaultMark
  onDelete?: () => void
  // Why it cannot be deleted now; the button is off with this as its tooltip.
  deleteBlocked?: string
}

// One model of the catalog with what can be done with it now. Its buttons say its
// state: Download, the progress with Cancel, Use and delete, or the reason with Retry.
export function ModelRow({
  icon, name, meta, state, pct = 0, error, onDownload, onCancel, onUse, selected, onDelete, deleteBlocked, defaultMark = 'badge',
}: ModelRowProps) {
  const installed = state === 'installed'
  const usable = installed && !selected && onUse
  const actions: ReactNode[] = []
  if (state === 'available' && onDownload) actions.push(<Button key="download" size="small" variant="secondary" onClick={onDownload}>Download</Button>)
  if (state === 'failed' && onDownload) actions.push(<Button key="retry" size="small" variant="secondary" icon="retry" onClick={onDownload}>Retry</Button>)
  if (state === 'downloading' && onCancel) actions.push(<Button key="cancel" size="small" variant="ghost" onClick={onCancel}>Cancel</Button>)
  if (usable) actions.push(<Button key="use" size="small" variant="ghost" onClick={onUse}>Use</Button>)
  if (selected && defaultMark === 'check') actions.push(<span key="default" className={styles.defaultCheck}><Icon name="check" size={14} />Default</span>)
  if (installed && onDelete) {
    const button = <IconButton key="delete" icon="delete" size="small" label={`Delete ${name}`} disabled={!!deleteBlocked} onClick={onDelete} />
    // A disabled button gets no pointer events: the tooltip hangs on a wrapper.
    actions.push(deleteBlocked
      ? <Tooltip key="delete" text={deleteBlocked}><span className={styles.blocked} tabIndex={0} aria-label={`${name} cannot be deleted: ${deleteBlocked}`}>{button}</span></Tooltip>
      : button)
  }
  return (
    <div
      className={cx(styles.modelRow, selected && styles.selected, selected && defaultMark === 'tint' && styles.tinted, usable && styles.usable)}
      onClick={usable ? onUse : undefined}
      aria-label={name}
      role="group"
    >
      {defaultMark === 'radio' && (installed || selected)
        ? <span className={cx(styles.radio, selected && styles.radioOn)} aria-hidden />
        : <span className={styles.icon}><Icon name={icon} /></span>}
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{name}</span>
          {selected && defaultMark === 'badge' && <Badge size="medium" tone="accent">Default</Badge>}
        </div>
        <div className={styles.meta}>
          {meta.filter(Boolean).map(item => <span key={item}>{item}</span>)}
          {selected && (defaultMark === 'tint' || defaultMark === 'radio') && <span className={styles.defaultText}>Default</span>}
        </div>
        {state === 'downloading' && (
          <div className={styles.progress}>
            <div role="progressbar" aria-label={`Downloading ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className={styles.track}>
              <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.pct}>{Math.round(pct)}%</span>
          </div>
        )}
        {state === 'failed' && <span role="alert" className={styles.error}>Download failed{error ? `: ${error}` : ''}</span>}
      </div>
      {/* Its buttons do their own thing, not the row's Use. */}
      <div className={styles.actions} onClick={event => event.stopPropagation()}>{actions}</div>
    </div>
  )
}
