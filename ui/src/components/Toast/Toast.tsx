import * as RadixToast from '@radix-ui/react-toast'
import { createPortal } from 'react-dom'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import { dismissToast, useToasts, type ToastOptions } from './toast'
import styles from './Toast.module.css'

interface ToastProps extends ToastOptions {
  onClose?: () => void
}

// One toast. Lives inside RadixToast.Provider with a viewport; Toaster is the
// one the app uses, stories set up their own to show every state in place.
export function Toast({ message, type = 'default', action, duration, onClose }: ToastProps) {
  return (
    <RadixToast.Root
      open
      duration={duration}
      type={type === 'error' ? 'foreground' : 'background'}
      className={cx(styles.toast, styles[type])}
      onOpenChange={open => { if (!open) onClose?.() }}
    >
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
      {entries.map(({ id, ...options }) => <Toast key={id} {...options} onClose={() => dismissToast(id)} />)}
      {createPortal(<RadixToast.Viewport className={styles.viewport} />, document.body)}
    </RadixToast.Provider>
  )
}
