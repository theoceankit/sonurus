import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import styles from './ModalBody.module.css'

// The free part of a modal. It scrolls when the window reaches the height of the
// screen, while the header and the footer stay.
export function ModalBody({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx(styles.modalBody, className)} data-modal-body {...props} />
}
