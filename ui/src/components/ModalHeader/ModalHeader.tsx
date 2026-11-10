import { Close, Description, Title } from '@radix-ui/react-dialog'
import { useLayoutEffect } from 'react'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import { IconButton } from '../IconButton/IconButton'
import { useModal } from '../Modal/Modal'
import { Stack } from '../Stack/Stack'
import styles from './ModalHeader.module.css'

interface ModalHeaderProps {
  title: string
  description?: string
  icon?: IconName
}

export function ModalHeader({ title, description, icon }: ModalHeaderProps) {
  const { setHasDescription } = useModal()
  const hasDescription = Boolean(description)

  // The window points at its description only when there is one.
  useLayoutEffect(() => {
    setHasDescription(hasDescription)
    return () => setHasDescription(false)
  }, [hasDescription, setHasDescription])

  return (
    <header className={styles.modalHeader} data-modal-header>
      {icon && <span className={styles.titleLine}><Icon name={icon} size={20} className={styles.icon} /></span>}
      <Stack gap="half" className={styles.heading}>
        <Title className={styles.title}>{title}</Title>
        {description && <Description className={styles.description}>{description}</Description>}
      </Stack>
      {/* On the line of the title, also with a description under it. */}
      <span className={styles.titleLine}>
        <Close asChild>
          <IconButton icon="close" size="xs" label="Close" />
        </Close>
      </span>
    </header>
  )
}
