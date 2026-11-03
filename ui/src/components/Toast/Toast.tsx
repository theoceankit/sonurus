import * as RadixToast from '@radix-ui/react-toast'
import { createPortal } from 'react-dom'
import { ExitSignal } from '../../presence'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import { dismissToast, removeToast, useToasts, type ToastOptions } from './toast'
import styles from './Toast.module.css'

interface ToastProps extends ToastOptions {
  // False plays the way out; onExited says it is over.
  open?: boolean
  onClose?: () => void
  onExited?: () => void
}

// One toast. Lives inside RadixToast.Provider with a viewport; Toaster is the
// one the app uses, stories set up their own to show every state in place.
export function Toast({ message, type = 'default', action, duration, open = true, onClose, onExited }: ToastProps) {
  return (
    <RadixToast.Root
      open={open}
      duration={duration}
      type={type === 'error' ? 'foreground' : 'background'}
      className={cx(styles.toast, styles[type])}
      onOpenChange={next => { if (!next) onClose?.() }}
    >
      <ExitSignal onExited={onExited} />
      <RadixToast.Title className={styles.message}>{message}</RadixToast.Title>
      {action && (
        <RadixToast.Action altText={action.label} className={styles.action} onClick={action.onClick}>
          {action.label}
        </RadixToast.Action>
      )}
      <RadixToast.Close aria-label="Close" className={styles.close}>
        <Icon name="close" size={12} />
      </RadixToast.Close>
    </RadixToast.Root>
  )
}

// Shows what toast() publishes. In a portal on the body, over the modal layer.
export function Toaster() {
  const entries = useToasts()
  return (
    <RadixToast.Provider label="Notifications">
      {entries.map(({ id, closing, ...options }) => (
        <Toast key={id} {...options} open={!closing} onClose={() => dismissToast(id)} onExited={() => removeToast(id)} />
      ))}
      {createPortal(<RadixToast.Viewport className={styles.viewport} />, document.body)}
    </RadixToast.Provider>
  )
}
