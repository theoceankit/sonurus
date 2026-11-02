import { Close } from '@radix-ui/react-dialog'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Button } from '../Button/Button'
import type { IconName } from '../Icon/icon-names'
import { useModal } from '../Modal/Modal'
import styles from './ModalFooter.module.css'

export type ModalAction = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: string
  icon?: IconName
  loading?: boolean
}

interface ModalFooterProps {
  // At the left: a Ghost button such as New speaker.
  leading?: ReactNode
  // By default Cancel, which closes. With an onClick it does what it is told and
  // stays open, as Back does; null leaves it out.
  cancel?: ModalAction | null
  // Its colour comes from the type of the modal.
  confirm?: ModalAction
}

export function ModalFooter({ leading, cancel = { children: 'Cancel' }, confirm }: ModalFooterProps) {
  const { type } = useModal()
  const cancelButton = cancel && <Button variant="secondary" data-modal-cancel {...cancel} />
  return (
    <footer className={styles.modalFooter} data-modal-footer>
      {leading}
      <div className={styles.spacer} />
      {cancelButton && (cancel.onClick ? cancelButton : <Close asChild>{cancelButton}</Close>)}
      {confirm && <Button variant={type === 'danger' ? 'danger' : 'primary'} {...confirm} />}
    </footer>
  )
}
