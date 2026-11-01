import * as Collapsible from '@radix-ui/react-collapsible'
import { useState, type ReactNode } from 'react'
import { Icon } from '../Icon/Icon'
import styles from './Disclosure.module.css'

interface DisclosureProps {
  label: string
  children: ReactNode
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  disabled?: boolean
  className?: string
}

// A quiet toggle for optional content below it. The click target hugs the
// chevron and the label; it is not the full row.
export function Disclosure({
  label, children, expanded, defaultExpanded = false, onExpandedChange, disabled, className,
}: DisclosureProps) {
  const [own, setOwn] = useState(defaultExpanded)
  const open = expanded ?? own
  return (
    <Collapsible.Root
      className={className}
      open={open}
      disabled={disabled}
      onOpenChange={next => {
        setOwn(next)
        onExpandedChange?.(next)
      }}
    >
      <Collapsible.Trigger className={styles.trigger}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        {label}
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  )
}
