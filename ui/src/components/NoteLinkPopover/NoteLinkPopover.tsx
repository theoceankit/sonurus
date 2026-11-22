import * as Popover from '@radix-ui/react-popover'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../Button/Button'
import { Inline } from '../Inline/Inline'
import { parseNoteLink } from '../NoteFormatBar/note-link'
import { Stack } from '../Stack/Stack'
import { TextField } from '../TextField/TextField'
import styles from './NoteLinkPopover.module.css'

interface NoteLinkPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The button it opens from, inside Popover.Trigger.
  children: ReactNode
  // The address of the link under the cursor; without one the window adds a link.
  href?: string
  onApply: (href: string) => void
  onRemove: () => void
  // Where the focus goes when it closes.
  onClosed: () => void
  // A press or the focus outside, which closes it; the target is where that was.
  onInteractOutside?: (event: Event) => void
}

function LinkForm({ href, onApply, onRemove }: Pick<NoteLinkPopoverProps, 'href' | 'onApply' | 'onRemove'>) {
  const [value, setValue] = useState(href ?? '')
  // As it opened: the cursor may be on another thing while the window leaves.
  const [onLink] = useState(href !== undefined)
  const [error, setError] = useState<string>()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = parseNoteLink(value)
    if (result.error !== undefined) setError(result.error)
    else onApply(result.href)
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack gap={2} align="stretch">
        <TextField
          aria-label="Link address"
          placeholder="https://"
          value={value}
          error={error}
          spellCheck={false}
          onChange={event => { setValue(event.target.value); setError(undefined) }}
        />
        <Inline gap={1}>
          {onLink && <Button variant="ghost" size="small" onClick={onRemove}>Remove link</Button>}
          <span className={styles.spacer} />
          <Button variant="primary" size="small" type="submit">Apply</Button>
        </Inline>
      </Stack>
    </form>
  )
}

// The address of a link: Enter applies, Escape closes and changes nothing.
export function NoteLinkPopover({ open, onOpenChange, children, href, onApply, onRemove, onClosed, onInteractOutside }: NoteLinkPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {children}
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label="Link"
          className={styles.popover}
          onInteractOutside={onInteractOutside}
          onCloseAutoFocus={event => { event.preventDefault(); onClosed() }}
        >
          <LinkForm href={href} onApply={onApply} onRemove={onRemove} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
