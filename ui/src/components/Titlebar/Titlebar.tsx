import { markNotImplemented } from '../../not-implemented'
import { cx } from '../../styles/cx'
import { IconButton, type IconButtonProps } from '../IconButton/IconButton'
import { SearchField } from '../SearchField/SearchField'
import { Tooltip, TooltipGroup } from '../Tooltip/Tooltip'
import styles from './Titlebar.module.css'

interface TitlebarProps {
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  // The inspector closes from inside its panel, so only opening it is here.
  inspectorOpen?: boolean
  onOpenInspector?: () => void
  onNewTranscription?: () => void
  onOpenSettings?: () => void
  onOpenSpeakers?: () => void
  className?: string
}

const ignore = () => {}

const Tool = ({ label, ...props }: IconButtonProps) => (
  <Tooltip text={label} placement="below">
    <IconButton label={label} {...props} />
  </Tooltip>
)

// The strip the window is dragged by. The system's window buttons stand over it,
// on either side: env(titlebar-area-*) in the styles keeps the controls clear of them.
export function Titlebar({ sidebarOpen = true, onToggleSidebar, inspectorOpen = true, onOpenInspector, onNewTranscription, onOpenSettings, onOpenSpeakers, className }: TitlebarProps) {
  return (
    <header className={cx(styles.titlebar, className)}>
      <div className={styles.brand}>
        <TooltipGroup>
          <span className={styles.nav}>
            <Tool icon="sidebar-toggle" label="Toggle sidebar" aria-expanded={sidebarOpen} onClick={onToggleSidebar} />
            <Tool icon="arrow-left" label="Back" {...markNotImplemented('titlebar.back')} />
            <Tool icon="arrow-right" label="Forward" {...markNotImplemented('titlebar.forward')} />
          </span>
        </TooltipGroup>
        <span className={styles.spacer} />
        <Tool icon="add" label="New recording" onClick={onNewTranscription} />
      </div>
      <div className={styles.search} {...markNotImplemented('titlebar.search')}>
        <SearchField value="" onValueChange={ignore} readOnly placeholder="Search transcripts" aria-label="Search transcripts" shortcut={['mod', 'K']} />
      </div>
      <div className={styles.actions}>
        <TooltipGroup>
          <span className={styles.nav}>
            <Tool icon="speakers" label="Speakers" onClick={onOpenSpeakers} />
            <Tool icon="settings" label="Settings" onClick={onOpenSettings} />
            {!inspectorOpen && <Tool icon="inspector" label="Show inspector" className={styles.appear} onClick={onOpenInspector} />}
          </span>
        </TooltipGroup>
      </div>
    </header>
  )
}
