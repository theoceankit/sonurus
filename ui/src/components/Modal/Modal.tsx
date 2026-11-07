import * as RadixDialog from '@radix-ui/react-dialog'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { holdWindowDim } from '../../platform/window-dim'
import { ExitSignal } from '../../presence'
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
  // The way out has played. A window shown for a value of state keeps that value until then.
  onExited?: () => void
  // Takes over from another window, with no way in and no second scrim.
  skipEnter?: boolean
  // ModalHeader, ModalBody, ModalFooter. The body is free, Penpot's slot is this.
  children: ReactNode
  // Draws the window in place, without scrim and focus trap, for a board of variants.
  preview?: boolean
}

interface ModalContextValue {
  type: ModalType
  setHasDescription: (has: boolean) => void
  // The window, for a popup inside it that must not go past its edges.
  boundary: HTMLElement | null
}

const ModalContext = createContext<ModalContextValue>({ type: 'default', setHasDescription: () => {}, boundary: null })
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

function openWindowUnder(closing: HTMLElement | null) {
  const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')]
  return open.filter(window => window !== closing).at(-1) ?? null
}

// Radix would start on the first element in the window, which is the close button.
function startingPoint(content: HTMLElement, type: ModalType) {
  const cancel = content.querySelector<HTMLElement>('[data-modal-cancel]')
  if (type === 'danger' && cancel) return cancel
  const start = content.querySelector<HTMLElement>('[data-modal-start]')
  if (start) return start
  return firstIn(content, '[data-modal-body]') ?? firstIn(content, '[data-modal-footer]') ?? firstIn(content, '[data-modal-header]')
}

export function Modal({ size = 'small', type = 'default', open, defaultOpen, onOpenChange, onExited, skipEnter, children, preview }: ModalProps) {
  const [hasDescription, setHasDescription] = useState(false)
  const content = useRef<HTMLDivElement | null>(null)
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    content.current = node
    setBoundary(node)
  }, [])
  const returnTo = useRef<HTMLElement | null>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false)
  const isOpen = !preview && (open ?? uncontrolledOpen)

  // The scrim does not reach the system's window buttons; the window dims them itself.
  useEffect(() => (isOpen ? holdWindowDim() : undefined), [isOpen])

  const window = (
    <RadixDialog.Content
      ref={contentRef}
      className={cx(styles.modal, styles[size], preview && styles.preview, skipEnter && styles.skipEnter)}
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
        // What opened it may be gone by now, such as the row of a deleted model, or a
        // window that closed to open this one: then the window still open under it.
        if (returnTo.current?.isConnected) returnTo.current.focus()
        else openWindowUnder(content.current)?.focus()
      }}
    >
      <ExitSignal onExited={onExited} />
      {children}
    </RadixDialog.Content>
  )

  return (
    <ModalContext.Provider value={{ type, setHasDescription, boundary }}>
      <RadixDialog.Root
        open={preview ? true : open}
        defaultOpen={defaultOpen}
        onOpenChange={next => {
          setUncontrolledOpen(next)
          onOpenChange?.(next)
        }}
        modal={!preview}
      >
        {preview ? window : (
          <RadixDialog.Portal>
            <RadixDialog.Overlay className={cx(styles.scrim, skipEnter && styles.skipEnter)} />
            {window}
          </RadixDialog.Portal>
        )}
      </RadixDialog.Root>
    </ModalContext.Provider>
  )
}
