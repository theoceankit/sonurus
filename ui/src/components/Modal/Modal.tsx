import * as RadixDialog from '@radix-ui/react-dialog'
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../styles/cx'
import styles from './Modal.module.css'

export type ModalSize = 'small' | 'medium' | 'large'
export type ModalType = 'default' | 'danger'

interface ModalProps {
  size?: ModalSize
  // Danger is for a destructive action: red confirm, and focus starts on Cancel so
  // that an Enter pressed too soon deletes nothing.
  type?: ModalType
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  // ModalHeader, ModalBody, ModalFooter. The body is free, Penpot's slot is this.
  children: ReactNode
  // Draws the window in place, without scrim and focus trap, for a board of variants.
  preview?: boolean
}

interface ModalContextValue {
  type: ModalType
  setHasDescription: (has: boolean) => void
}

const ModalContext = createContext<ModalContextValue>({ type: 'default', setHasDescription: () => {} })
export const useModal = () => useContext(ModalContext)

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const firstIn = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(`${selector} :is(${FOCUSABLE})`)

// Where focus goes on closing. An item of a menu is gone by then, so a window opened
// from a menu goes back to the menu's button.
function returnPoint() {
  const active = document.activeElement as HTMLElement | null
  const menuButton = active?.closest('[role="menu"]')?.getAttribute('aria-labelledby')
  return (menuButton && document.getElementById(menuButton)) || active
}

// Radix would start on the first element in the window, which is the close button.
function startingPoint(content: HTMLElement, type: ModalType) {
  const cancel = content.querySelector<HTMLElement>('[data-modal-cancel]')
  if (type === 'danger' && cancel) return cancel
  const start = content.querySelector<HTMLElement>('[data-modal-start]')
  if (start) return start
  return firstIn(content, '[data-modal-body]') ?? firstIn(content, '[data-modal-footer]') ?? firstIn(content, '[data-modal-header]')
}

export function Modal({ size = 'small', type = 'default', open, defaultOpen, onOpenChange, children, preview }: ModalProps) {
  const [hasDescription, setHasDescription] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  const window = (
    <RadixDialog.Content
      ref={content}
      className={cx(styles.modal, styles[size], preview && styles.preview)}
      {...(type === 'danger' ? { role: 'alertdialog' } : {})}
      {...(hasDescription ? {} : { 'aria-describedby': undefined })}
      onOpenAutoFocus={event => {
        event.preventDefault()
        if (preview) return
        // Radix returns focus only to its own Trigger, and a modal here is opened from anywhere.
        returnTo.current = returnPoint()
        if (content.current) startingPoint(content.current, type)?.focus()
      }}
      onCloseAutoFocus={event => {
        event.preventDefault()
        returnTo.current?.focus()
      }}
    >
      {children}
    </RadixDialog.Content>
  )

  return (
    <ModalContext.Provider value={{ type, setHasDescription }}>
      <RadixDialog.Root
        open={preview ? true : open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        modal={!preview}
      >
        {preview ? window : (
          <RadixDialog.Portal>
            <RadixDialog.Overlay className={styles.scrim} />
            {window}
          </RadixDialog.Portal>
        )}
      </RadixDialog.Root>
    </ModalContext.Provider>
  )
}
