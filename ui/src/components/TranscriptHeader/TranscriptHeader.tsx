import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import { IconButton, type IconButtonProps } from '../IconButton/IconButton'
import { Menu, MenuAction } from '../Menu/Menu'
import { MetaItem } from '../MetaItem/MetaItem'
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
  // For a story: the field without a click.
  initialRenaming?: boolean
}

const Action = ({ label, ...props }: IconButtonProps) => (
  <Tooltip text={label}>
    <IconButton label={label} {...props} />
  </Tooltip>
)

// A disabled button gets no pointer events, so Copy transcript has no tooltip with nothing to copy.
const Actions = ({ onDelete, onCopy }: { onDelete?: () => void; onCopy?: () => void }) => (
  <TooltipGroup>
    <div className={styles.actions}>
      <Action icon="pin" label="Pin" {...markNotImplemented('transcript.pin')} />
      <Action icon="copy" label="Copy transcript" disabled={!onCopy} onClick={onCopy} />
      <Action icon="export" label="Export" {...markNotImplemented('transcript.export')} />
      <Menu align="end" trigger={<Tooltip text="More"><IconButton icon="more" label="More" /></Tooltip>}>
        <MenuAction icon="delete" onSelect={onDelete}>Delete recording</MenuAction>
      </Menu>
    </div>
  </TooltipGroup>
)

export function TranscriptHeader({ title, date, language, sticky, onRename, onDelete, onCopy, initialRenaming = false, className, ...props }: TranscriptHeaderProps) {
  const [renaming, setRenaming] = useState(initialRenaming)
  const button = useRef<HTMLButtonElement>(null)

  if (sticky) {
    return (
      <header className={cx(styles.sticky, className)} {...props}>
        <span className={styles.stickyTitle}>{title}</span>
        <Actions onDelete={onDelete} onCopy={onCopy} />
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
        <Actions onDelete={onDelete} onCopy={onCopy} />
      </div>
      <div className={styles.titleRow}>
        <h1 className={cx(styles.title, renaming && styles.titleHidden)}>
          <button ref={button} type="button" className={styles.titleButton} onClick={() => setRenaming(true)}>{title}</button>
        </h1>
        {renaming && (
          <TitleField
            title={title}
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

function TitleField({ title, onDone }: { title: string; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  // Taking the field away moves the focus, and that must not finish twice.
  const finished = useRef(false)

  useEffect(() => { input.current!.select() }, [])

  const finish = (next: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(next)
  }

  return (
    <input
      ref={input}
      autoFocus
      aria-label="Transcript title"
      maxLength={200}
      className={styles.input}
      value={value}
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        }
      }}
    />
  )
}
