import { useRef, useState, type ComponentPropsWithRef } from 'react'
import { markNotImplemented } from '../../not-implemented'
import type { ExportFormat } from '../../platform/electron-api'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import { IconButton, type IconButtonProps } from '../IconButton/IconButton'
import { Menu, MenuAction, MenuDivider } from '../Menu/Menu'
import { MetaItem } from '../MetaItem/MetaItem'
import { TitleField } from '../TitleField/TitleField'
import { Tooltip, TooltipGroup } from '../Tooltip/Tooltip'
import styles from './TranscriptHeader.module.css'

type TranscriptHeaderProps = Omit<ComponentPropsWithRef<'header'>, 'title' | 'children'> & {
  title: string
  date?: string
  language?: string
  // The bar that stays at the top while the list scrolls under it.
  sticky?: boolean
  // Gets what was typed; checking it is up to the caller.
  onRename?: (title: string) => void
  onDelete?: () => void
  // Copies the whole transcript; without it there is nothing to copy and the button is disabled.
  onCopy?: () => void
  // Saves the transcript to a file of the format picked; without it there is nothing to
  // save and the button is disabled.
  onExport?: (format: ExportFormat) => void
  // Export settings at the end of the menu of Export.
  onExportSettings?: () => void
  // For a story: the field without a click.
  initialRenaming?: boolean
}

// The header stands at the top of the transcript: its tooltips hang below.
const Action = ({ label, ...props }: IconButtonProps) => (
  <Tooltip text={label} placement="below">
    <IconButton label={label} {...props} />
  </Tooltip>
)

const EXPORT_FORMATS: { format: ExportFormat; label: string; meta: string }[] = [
  { format: 'txt', label: 'Plain text', meta: '.txt' },
  { format: 'md', label: 'Markdown', meta: '.md' },
  { format: 'json', label: 'JSON', meta: '.json' },
]

type ActionsProps = Pick<TranscriptHeaderProps, 'onDelete' | 'onCopy' | 'onExport' | 'onExportSettings'>

// A disabled button gets no pointer events, so Copy transcript and Export have no tooltip with no speech.
const Actions = ({ onDelete, onCopy, onExport, onExportSettings }: ActionsProps) => (
  <TooltipGroup>
    <div className={styles.actions}>
      <Action icon="pin" label="Pin" {...markNotImplemented('transcript.pin')} />
      <Action icon="copy" label="Copy transcript" disabled={!onCopy} onClick={onCopy} />
      <Menu align="end" size="compact" trigger={<Tooltip text="Export" placement="below"><IconButton icon="export" label="Export" disabled={!onExport} /></Tooltip>}>
        {EXPORT_FORMATS.map(({ format, label, meta }) => (
          <MenuAction key={format} meta={meta} onSelect={() => onExport?.(format)}>{label}</MenuAction>
        ))}
        <MenuDivider />
        <MenuAction icon="settings" onSelect={onExportSettings}>Export settings</MenuAction>
      </Menu>
      <Menu align="end" trigger={<Tooltip text="More" placement="below"><IconButton icon="more" label="More" /></Tooltip>}>
        <MenuAction icon="delete" onSelect={onDelete}>Delete recording</MenuAction>
      </Menu>
    </div>
  </TooltipGroup>
)

export function TranscriptHeader({ title, date, language, sticky, onRename, onDelete, onCopy, onExport, onExportSettings, initialRenaming = false, className, ...props }: TranscriptHeaderProps) {
  const [renaming, setRenaming] = useState(initialRenaming)
  const button = useRef<HTMLButtonElement>(null)

  if (sticky) {
    return (
      <header className={cx(styles.sticky, className)} {...props}>
        <span className={styles.stickyTitle}>{title}</span>
        <Actions onDelete={onDelete} onCopy={onCopy} onExport={onExport} onExportSettings={onExportSettings} />
      </header>
    )
  }

  // The focus goes back to the title unless it already went somewhere else.
  const stopRenaming = () => {
    setRenaming(false)
    requestAnimationFrame(() => { if (document.activeElement === document.body) button.current?.focus() })
  }

  return (
    <header className={cx(styles.header, className)} {...props}>
      <div className={styles.topRow}>
        <button type="button" className={styles.folder} {...markNotImplemented('transcript.folder')}>
          <Icon name="folder" />
          No folder
        </button>
        <Actions onDelete={onDelete} onCopy={onCopy} onExport={onExport} onExportSettings={onExportSettings} />
      </div>
      <div className={styles.titleRow}>
        <h1 className={cx(styles.title, renaming && styles.titleHidden)}>
          <button ref={button} type="button" className={styles.titleButton} onClick={() => setRenaming(true)}>{title}</button>
        </h1>
        {renaming && (
          <TitleField
            title={title}
            label="Transcript title"
            className={styles.input}
            onDone={next => {
              if (next !== null) onRename?.(next)
              stopRenaming()
            }}
          />
        )}
      </div>
      {(date || language) && (
        <div className={styles.meta}>
          {date && <MetaItem icon="calendar">{date}</MetaItem>}
          {language && <MetaItem icon="globe">{language}</MetaItem>}
        </div>
      )}
    </header>
  )
}
