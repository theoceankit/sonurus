import { useEffect, useRef, useState, type ReactNode } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { cx } from '../../styles/cx'
import { IconButton, type IconButtonProps } from '../IconButton/IconButton'
import { SearchField } from '../SearchField/SearchField'
import { Tooltip, TooltipGroup } from '../Tooltip/Tooltip'
import styles from './Titlebar.module.css'

interface TitlebarProps {
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  // Through the recordings opened. Each button is off while there is nowhere to go.
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
  // The inspector closes from inside its panel, so only opening it is here.
  inspectorOpen?: boolean
  onOpenInspector?: () => void
  onNewTranscription?: () => void
  onOpenSettings?: () => void
  onOpenSpeakers?: () => void
  // Before the tools on the right, such as a recording in progress.
  status?: ReactNode
  className?: string
}

const ignore = () => {}

const Tool = ({ label, ...props }: IconButtonProps) => (
  <Tooltip text={label} placement="below">
    <IconButton label={label} {...props} />
  </Tooltip>
)

// After a click the sidebar has done what the icon showed, so the icon rests until
// the pointer leaves rather than at once show the way back (data-settled).
function SidebarToggle({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  const [settled, setSettled] = useState(false)
  return (
    <Tool
      icon="sidebar-toggle"
      label="Toggle sidebar"
      aria-expanded={open}
      className={styles.sidebarToggle}
      data-settled={settled || undefined}
      onPointerLeave={() => setSettled(false)}
      onClick={() => {
        setSettled(true)
        onToggle?.()
      }}
    />
  )
}

// Shows only while the inspector is closed. When it opens the button goes back the
// way it came: it stays until its animations have finished.
function ShowInspector({ shown, onOpen }: { shown: boolean; onOpen?: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [wasShown, setWasShown] = useState(shown)
  if (shown !== wasShown) {
    setWasShown(shown)
    setLeaving(!shown)
  }
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!leaving) return
    let gone = false
    const animations = ref.current?.getAnimations?.() ?? []
    // A cancelled animation, as when the inspector closes again at once, also ends it.
    Promise.allSettled(animations.map(a => a.finished)).then(() => { if (!gone) setLeaving(false) })
    return () => { gone = true }
  }, [leaving])
  return (
    <span className={styles.inspectorRoom} data-open={shown || undefined}>
      {(shown || leaving) && (
        <Tool
          ref={ref}
          icon="inspector"
          label="Show inspector"
          className={cx(styles.showInspector, leaving ? styles.disappear : styles.appear)}
          inert={leaving || undefined}
          onClick={onOpen}
        />
      )}
    </span>
  )
}

// The strip the window is dragged by. The system's window buttons stand over it,
// on either side: env(titlebar-area-*) in the styles keeps the controls clear of them.
export function Titlebar({ sidebarOpen = true, onToggleSidebar, canGoBack = false, canGoForward = false, onBack, onForward, inspectorOpen = true, onOpenInspector, onNewTranscription, onOpenSettings, onOpenSpeakers, status, className }: TitlebarProps) {
  return (
    <header className={cx(styles.titlebar, className)}>
      <div className={styles.brand}>
        <TooltipGroup>
          <span className={styles.nav}>
            <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
            <Tool icon="arrow-left" label="Back" disabled={!canGoBack} onClick={onBack} />
            <Tool icon="arrow-right" label="Forward" disabled={!canGoForward} onClick={onForward} />
          </span>
        </TooltipGroup>
        <span className={styles.spacer} />
        <Tool icon="add" label="New recording" onClick={onNewTranscription} />
      </div>
      <div className={styles.search} {...markNotImplemented('titlebar.search')}>
        <SearchField value="" onValueChange={ignore} readOnly placeholder="Search transcripts" aria-label="Search transcripts" shortcut={['mod', 'K']} />
      </div>
      <div className={styles.actions}>
        {status}
        <TooltipGroup>
          <span className={styles.nav}>
            <Tool icon="speakers" label="Speakers" onClick={onOpenSpeakers} />
            <Tool icon="settings" label="Settings" onClick={onOpenSettings} />
            <ShowInspector shown={!inspectorOpen} onOpen={onOpenInspector} />
          </span>
        </TooltipGroup>
      </div>
    </header>
  )
}
