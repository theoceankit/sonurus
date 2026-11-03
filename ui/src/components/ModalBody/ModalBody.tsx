import { useState, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import styles from './ModalBody.module.css'

// The free part of a modal. It scrolls when the window reaches the height of the
// screen, while the header and the footer stay.
export function ModalBody({ className, ...props }: Omit<ComponentPropsWithRef<'div'>, 'ref'>) {
  const [area, setArea] = useState<HTMLElement | null>(null)
  return (
    <>
      <div ref={setArea} className={cx(styles.modalBody, className)} data-modal-body {...props} />
      <ScrollBar area={area} />
    </>
  )
}
