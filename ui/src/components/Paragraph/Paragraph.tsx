import { useEffect, useRef, useState, type ComponentPropsWithRef, type FocusEvent, type KeyboardEvent } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Menu, MenuAction } from '../Menu/Menu'
import { Toolbar, ToolbarAction, ToolbarItem } from '../Toolbar/Toolbar'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './Paragraph.module.css'

const SAVE_KEY = /mac/i.test(navigator.platform) ? '⌘↵' : 'Ctrl+Enter'

type ParagraphProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'color' | 'onCopy'> & {
  text: string
  // The speaker's colour, for the bar of the one playing.
  color: SpeakerColor
  playing?: boolean
  editing?: boolean
  // The bar of actions stays, as for the speaker menu it opened; a story shows it this way.
  showActions?: boolean
  onPlay?: () => void
  onEdit?: () => void
  onCopy?: () => void
  // Gets the button of the menu, for the speaker menu to open at it.
  onChangeSpeaker?: (button: HTMLElement) => void
  onDelete?: () => void
  onSave?: (text: string) => void
  onCancel?: () => void
}

// One segment of a turn. The bar of actions and the field exist only on the paragraph
// that needs them, or a long recording would hold thousands of them.
export function Paragraph({
  text, color, playing, editing, showActions, onPlay, onEdit, onCopy, onChangeSpeaker, onDelete, onSave, onCancel, className, ...props
}: ParagraphProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  // The speaker menu takes the focus, and closing this menu must not take it back.
  const leavingFocus = useRef(false)

  // A click focuses the paragraph too, and the bar must not stay after the pointer has left.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => { if (event.target.matches(':focus-visible')) setFocused(true) }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
  }

  return (
    <div
      tabIndex={-1}
      data-nav=""
      className={cx(styles.paragraph, !editing && styles.interactive, className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={onFocus}
      onBlur={onBlur}
      {...props}
    >
      <span className={styles.gutter} />
      {playing && !editing && <span className={styles.bar} data-testid="playing" style={{ background: `var(--color-speaker-${color}-mid)` }} />}
      {editing
        ? <ParagraphField text={text} onSave={onSave} onCancel={onCancel} />
        : <p className={styles.text} data-transcript-text="" onDoubleClick={onEdit}>{text}</p>}
      {!editing && (hovered || focused || menuOpen || showActions) && (
        <Toolbar label="Paragraph" className={styles.actions}>
          <ToolbarAction icon="play" label="Play" onClick={onPlay} />
          <ToolbarAction icon="edit" label="Edit" onClick={onEdit} />
          <ToolbarAction icon="copy" label="Copy" onClick={onCopy} />
          <Menu
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onCloseAutoFocus={event => {
              if (leavingFocus.current) event.preventDefault()
              leavingFocus.current = false
            }}
            trigger={<Tooltip text="More"><ToolbarItem ref={more}><IconButton icon="more" label="More" /></ToolbarItem></Tooltip>}
          >
            <MenuAction icon="reassign-speaker" onSelect={() => {
              leavingFocus.current = true
              onChangeSpeaker?.(more.current!)
            }}>Change speaker</MenuAction>
            <MenuAction icon="delete" onSelect={onDelete}>Delete</MenuAction>
          </Menu>
        </Toolbar>
      )}
    </div>
  )
}

interface ParagraphFieldProps {
  text: string
  onSave?: (text: string) => void
  onCancel?: () => void
}

function ParagraphField({ text, onSave, onCancel }: ParagraphFieldProps) {
  const [value, setValue] = useState(text)
  const area = useRef<HTMLTextAreaElement>(null)
  // Taking the field away moves the focus, and that must not finish the edit twice.
  const finished = useRef(false)

  useEffect(() => {
    const node = area.current!
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [])

  const finish = (save: boolean) => {
    if (finished.current) return
    finished.current = true
    const next = value.trim()
    if (save && next && next !== text) onSave?.(next)
    else onCancel?.()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
  }

  return (
    <div
      className={styles.field}
      onKeyDown={onKeyDown}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) finish(true) }}
    >
      <textarea ref={area} aria-label="Paragraph text" className={styles.area} value={value} onChange={event => setValue(event.target.value)} />
      <div className={styles.footer}>
        <span className={styles.hint}>Esc to cancel, {SAVE_KEY} to save</span>
        {/* The press stays off the buttons, so the field keeps the focus until the click. */}
        <Button variant="secondary" size="small" onMouseDown={event => event.preventDefault()} onClick={() => finish(false)}>Cancel</Button>
        <Button variant="primary" size="small" onMouseDown={event => event.preventDefault()} onClick={() => finish(true)}>Save</Button>
      </div>
    </div>
  )
}
