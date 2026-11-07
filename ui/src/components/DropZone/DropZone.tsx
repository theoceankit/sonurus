import { useRef, useState, type DragEvent } from 'react'
import { cx } from '../../styles/cx'
import { Button } from '../Button/Button'
import { Icon } from '../Icon/Icon'
import { Stack } from '../Stack/Stack'
import styles from './DropZone.module.css'

interface DropZoneProps {
  // Shows files over the zone without a drag, for a story.
  over?: boolean
  // What the files may be, under the call to drop them.
  hint?: string
  onChooseFiles?: () => void
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

// Lights up while files are dragged over it, and only then. Taking the drop is left to
// whoever listens on the window: the zone only shows where to drop.
export function DropZone({ over: forcedOver = false, hint, onChooseFiles }: DropZoneProps) {
  // Enter and leave come for every child crossed: only the first and the last count.
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const enter = (event: DragEvent) => {
    if (!hasFiles(event)) return
    if (++depth.current === 1) setOver(true)
  }
  const leave = (event: DragEvent) => {
    if (!hasFiles(event)) return
    if (--depth.current > 0) return
    depth.current = 0
    setOver(false)
  }
  const drop = () => {
    depth.current = 0
    setOver(false)
  }
  const lit = over || forcedOver

  return (
    <Stack
      gap={3}
      align="center"
      justify="center"
      className={cx(styles.dropZone, lit && styles.over)}
      data-over={lit || undefined}
      onDragEnter={enter}
      onDragLeave={leave}
      onDrop={drop}
    >
      <Icon name="download" size={24} className={styles.icon} />
      <Stack gap="half" align="center">
        <span className={styles.title}>{lit ? 'Drop to add the files' : 'Drop audio or video files here'}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </Stack>
      <Button size="small" onClick={onChooseFiles}>Choose files</Button>
    </Stack>
  )
}
