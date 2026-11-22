import * as Popover from '@radix-ui/react-popover'
import { useEditorState, type Editor } from '@tiptap/react'
import { memo, useRef, useState, type MouseEvent } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import { IconButton } from '../IconButton/IconButton'
import { Menu, MenuOption, MenuOptions } from '../Menu/Menu'
import { keepSelection } from '../NoteEditor/note-extensions'
import { NoteLinkPopover } from '../NoteLinkPopover/NoteLinkPopover'
import { Toolbar, ToolbarDivider, ToolbarItem } from '../Toolbar/Toolbar'
import { Tooltip } from '../Tooltip/Tooltip'
import {
  formatState, NO_FORMAT, removeNoteLink, setNoteLink, setParagraph, toggleBlockquote, toggleBold, toggleHeading, toggleItalic, toggleList,
  type HeadingLevel, type TextStyle,
} from './note-format'
import styles from './NoteFormatBar.module.css'

const STYLES: { value: TextStyle; short: string; label: string }[] = [
  { value: 'paragraph', short: 'Text', label: 'Plain text' },
  { value: 'h1', short: 'H1', label: 'Heading 1' },
  { value: 'h2', short: 'H2', label: 'Heading 2' },
  { value: 'h3', short: 'H3', label: 'Heading 3' },
]

// The press does not take the focus: the cursor and the selection stay in the note.
const keepFocus = (event: MouseEvent) => event.preventDefault()

type BarWindow = 'link' | 'style'

interface FormatButtonProps {
  icon: IconName
  label: string
  active: boolean
  enabled: boolean
  onPress: () => void
}

function FormatButton({ icon, label, active, enabled, onPress }: FormatButtonProps) {
  return (
    <Tooltip text={label}>
      <ToolbarItem disabled={!enabled} onMouseDown={keepFocus} onClick={onPress}>
        <IconButton icon={icon} label={label} selected={active} />
      </ToolbarItem>
    </Tooltip>
  )
}

interface NoteFormatBarProps {
  editor: Editor | null
  // Inserts where the player stands; without it there is no time button.
  onInsertTime?: () => void
  // While the player has no audio: the button stays, out of use.
  timeDisabled?: boolean
  className?: string
}

// The row of formats over a note. Made again for each editor: useEditorState keeps what
// it read until a transaction, and a note just opened has had none.
// Memoized: the panel over it renders with the player's time.
export const NoteFormatBar = memo(function NoteFormatBar({ editor, ...props }: NoteFormatBarProps) {
  return <FormatRow key={editor?.instanceId ?? 'none'} editor={editor} {...props} />
})

// It renders with the cursor; the editor under it does not.
function FormatRow({ editor, onInsertTime, timeDisabled = false, className }: NoteFormatBarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? formatState(current) : NO_FORMAT),
  }) ?? NO_FORMAT
  const bar = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<BarWindow | null>(null)
  // As open, for what runs as the other one closes, before a render.
  const openNow = useRef<BarWindow | null>(null)
  const wentElsewhere = useRef(false)
  const openChange = (which: BarWindow) => (next: boolean) => {
    if (next) {
      wentElsewhere.current = false
      if (editor) keepSelection(editor, true)
    } else if (openNow.current !== which) return
    openNow.current = next ? which : null
    setOpen(openNow.current)
  }
  // The link window and the menu give the focus back to the note, unless they were
  // left for something outside it and its bar, or for the other one of them.
  const outside = (event: Event) => {
    const to = event.target as Node
    wentElsewhere.current = !(bar.current?.contains(to) || editor?.view.dom.contains(to))
  }
  const giveBack = () => {
    if (openNow.current || !editor || editor.isDestroyed) return
    keepSelection(editor, false)
    if (!wentElsewhere.current) editor.commands.focus()
  }
  const run = (command: (editor: Editor) => void) => () => { if (editor) command(editor) }

  const chooseStyle = (value: string) => {
    if (!editor) return
    if (value === 'paragraph') setParagraph(editor)
    else toggleHeading(editor, Number(value.slice(1)) as HeadingLevel)
  }
  const current = STYLES.find(style => style.value === state.textStyle)
  const styleEnabled = state.can.paragraph || state.can.heading
  const heading = state.textStyle !== null && state.textStyle !== 'paragraph'

  return (
    <div ref={bar} className={cx(styles.bar, className)}>
      <Toolbar label="Format" variant="flat">
        <Menu
          size="compact"
          open={open === 'style'}
          onOpenChange={openChange('style')}
          onInteractOutside={outside}
          trigger={(
            <Tooltip text="Text style">
              <ToolbarItem disabled={!styleEnabled} aria-label="Text style" className={cx(styles.style, heading && styles.styleActive)}>
                <button type="button">
                  <span>{current?.short ?? 'Text'}</span>
                  <Icon name="chevron-down" size={12} />
                </button>
              </ToolbarItem>
            </Tooltip>
          )}
          onCloseAutoFocus={event => { event.preventDefault(); giveBack() }}
        >
          <MenuOptions value={state.textStyle ?? ''} onValueChange={chooseStyle}>
            {STYLES.map(style => (
              <MenuOption key={style.value} value={style.value} disabled={style.value !== state.textStyle && !(style.value === 'paragraph' ? state.can.paragraph : state.can.heading)}>
                {style.label}
              </MenuOption>
            ))}
          </MenuOptions>
        </Menu>
        <ToolbarDivider />
        <FormatButton icon="bold" label="Bold" active={state.bold} enabled={state.can.bold} onPress={run(toggleBold)} />
        <FormatButton icon="italic" label="Italic" active={state.italic} enabled={state.can.italic} onPress={run(toggleItalic)} />
        <ToolbarDivider />
        <FormatButton icon="list-bullet" label="Bulleted list" active={state.bulletList} enabled={state.can.bulletList} onPress={run(e => toggleList(e, 'bulletList'))} />
        <FormatButton icon="list-numbered" label="Numbered list" active={state.orderedList} enabled={state.can.orderedList} onPress={run(e => toggleList(e, 'orderedList'))} />
        <FormatButton icon="checkbox" label="Checkbox" active={state.taskList} enabled={state.can.taskList} onPress={run(e => toggleList(e, 'taskList'))} />
        <FormatButton icon="quote" label="Quote" active={state.blockquote} enabled={state.can.blockquote} onPress={run(toggleBlockquote)} />
        <ToolbarDivider />
        <NoteLinkPopover
          open={open === 'link'}
          onOpenChange={openChange('link')}
          onInteractOutside={outside}
          href={state.link ? editor?.getAttributes('link').href : undefined}
          onApply={href => { if (editor) setNoteLink(editor, href); openChange('link')(false) }}
          onRemove={() => { if (editor) removeNoteLink(editor); openChange('link')(false) }}
          onClosed={giveBack}
        >
          <Tooltip text="Link">
            <Popover.Trigger asChild>
              <ToolbarItem disabled={!state.can.link} onMouseDown={keepFocus}>
                <IconButton icon="link" label="Link" selected={state.link} />
              </ToolbarItem>
            </Popover.Trigger>
          </Tooltip>
        </NoteLinkPopover>
        {onInsertTime && (
          <>
            <ToolbarDivider />
            <Tooltip text="Insert player time">
              <ToolbarItem disabled={timeDisabled || !editor} onMouseDown={keepFocus} onClick={onInsertTime}>
                <IconButton icon="clock" label="Insert player time" />
              </ToolbarItem>
            </Tooltip>
          </>
        )}
      </Toolbar>
    </div>
  )
}
