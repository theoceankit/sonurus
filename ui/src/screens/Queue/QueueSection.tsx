import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useQueue, useQueueControl, useReorderQueue, useRetryQueueJob } from '../../api/queries'
import type { QueueJob, QueueSnapshot } from '../../api/types'
import { IconButton } from '../../components/IconButton/IconButton'
import { Menu, MenuAction } from '../../components/Menu/Menu'
import { QueueRow } from '../../components/QueueRow/QueueRow'
import { SectionHeader } from '../../components/SectionHeader/SectionHeader'
import { toast } from '../../components/Toast/toast-store'
import { Tooltip } from '../../components/Tooltip/Tooltip'
import { useLingering } from '../../presence'
import { DeleteJobDialog } from './DeleteJobDialog'
import { EditJobDialog } from './EditJobDialog'
import { canEditJob } from './job-settings'
import { dropPlace, moveJob, queueStateLabel, queueToggle, reorderJobIds, type DropPlace } from './queue'
import styles from './QueueSection.module.css'

// What a dragged row carries. A drag without it, such as files from outside, is
// not a row's: the window's drop zone takes files only.
export const JOB_DRAG_TYPE = 'application/x-sonorus-job'

export const refused = (error: Error) => toast({ message: error.message, type: 'error' })

const carriesJob = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(JOB_DRAG_TYPE)
const inActions = (target: EventTarget) => !!(target as HTMLElement).closest('[data-row-actions]')

interface QueueSectionProps {
  // The job shown in the centre, if any.
  selectedJobId?: string | null
  onSelectJob?: (jobId: string) => void
}

// The transcription queue above the recordings list, while it has jobs, in the style
// of the list's sections. Snapshots come from WS /ws/queue (useQueueEventsSync in App).
export function QueueSection({ selectedJobId = null, onSelectJob }: QueueSectionProps) {
  const { data: live } = useQueue()
  const control = useQueueControl()
  const reorder = useReorderQueue()
  const retry = useRetryQueueJob()
  const [editing, setEditing] = useState<QueueJob | null>(null)
  const [toDelete, setToDelete] = useState<QueueJob | null>(null)
  // The row whose menu is open: from its More button, or by a right click on the row.
  const [menuOf, setMenuOf] = useState<string | null>(null)
  const deleteDialog = useLingering(toDelete)

  // While a row is dragged the queue stays as it was when the drag began, so the
  // row under the pointer does not move away; the latest one shows after the drop.
  const [drag, setDrag] = useState<{ id: string; frozen: QueueSnapshot } | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; place: DropPlace } | null>(null)

  // A row moved from the keyboard keeps the focus once the new order is shown.
  const rows = useRef(new Map<string, HTMLDivElement>())
  const refocus = useRef<string | null>(null)
  const snapshot = drag?.frozen ?? live
  useEffect(() => {
    if (!refocus.current) return
    const button = rows.current.get(refocus.current)?.querySelector('button')
    if (button && document.activeElement !== button) button.focus()
  }, [snapshot?.jobs])

  const dialogs = (
    <>
      <EditJobDialog job={editing} onClose={() => setEditing(null)} />
      {deleteDialog.value && (
        <DeleteJobDialog
          key={deleteDialog.key}
          job={deleteDialog.value}
          open={deleteDialog.open}
          onClose={() => setToDelete(null)}
          onExited={deleteDialog.exited}
        />
      )}
    </>
  )
  // The dialogs stay for their way out when the last job goes.
  if (!snapshot || snapshot.jobs.length === 0) return dialogs

  const ids = () => (live ?? snapshot).jobs.map(job => job.id)
  const sendOrder = (order: string[] | null, focused?: string) => {
    if (!order || order.every((id, i) => id === ids()[i])) return
    refocus.current = focused ?? null
    reorder.mutate(order, {
      onError: refused,
      onSettled: () => { setTimeout(() => { refocus.current = null }) },
    })
  }

  const toggle = queueToggle(snapshot)

  const keyDown = (job: QueueJob) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (inActions(event.target) || !event.altKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    sendOrder(moveJob(ids(), job.id, event.key === 'ArrowUp' ? -1 : 1), job.id)
  }

  const dragProps = (job: QueueJob) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      // A drag that starts on a button at the end of the row is a click that slipped.
      if (inActions(event.target)) return event.preventDefault()
      event.dataTransfer.setData(JOB_DRAG_TYPE, job.id)
      event.dataTransfer.effectAllowed = 'move'
      setDrag({ id: job.id, frozen: snapshot })
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!carriesJob(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const place = dropPlace(event.currentTarget.getBoundingClientRect(), event.clientY)
      const next = drag?.id === job.id ? null : { id: job.id, place }
      if (next?.id !== dropAt?.id || next?.place !== dropAt?.place) setDropAt(next)
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropAt?.id === job.id) setDropAt(null)
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!carriesJob(event)) return
      event.preventDefault()
      const dragged = event.dataTransfer.getData(JOB_DRAG_TYPE)
      sendOrder(reorderJobIds(ids(), dragged, job.id, dropPlace(event.currentTarget.getBoundingClientRect(), event.clientY)))
      setDropAt(null)
    },
    onDragEnd: () => {
      setDrag(null)
      setDropAt(null)
    },
  })

  return (
    <section aria-label="Transcription queue" className={styles.queueSection}>
      {/* No button here: pausing is in each row's menu, and the header says so. */}
      <SectionHeader title="Queue" meta={snapshot.paused ? queueStateLabel(snapshot) : undefined} />
      <ul className={styles.list}>
        {snapshot.jobs.map(job => (
          <li key={job.id}>
            <QueueRow
              ref={element => {
                if (element) rows.current.set(job.id, element)
                else rows.current.delete(job.id)
              }}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              title={job.title}
              status={job.status}
              selected={job.id === selectedJobId}
              onClick={() => onSelectJob?.(job.id)}
              actions={<>
                {job.status === 'failed' && (
                  <Tooltip text="Retry" placement="below">
                    <IconButton
                      variant="ghost"
                      size="xs"
                      icon="retry"
                      label="Retry"
                      disabled={retry.isPending && retry.variables === job.id}
                      onClick={() => retry.mutate(job.id, { onError: refused })}
                    />
                  </Tooltip>
                )}
                <Menu
                  align="end"
                  open={menuOf === job.id}
                  onOpenChange={open => setMenuOf(open ? job.id : null)}
                  trigger={<IconButton variant="ghost" size="xs" icon="more" label="More" />}
                >
                  <MenuAction icon={toggle.icon} onSelect={() => control.mutate(toggle.action, { onError: refused })}>{toggle.label}</MenuAction>
                  {canEditJob(job) && <MenuAction icon="edit" onSelect={() => setEditing(job)}>Transcription settings</MenuAction>}
                  <MenuAction icon="delete" onSelect={() => setToDelete(job)}>Delete from queue</MenuAction>
                </Menu>
              </>}
              drop={dropAt?.id === job.id ? dropAt.place : null}
              dragging={drag?.id === job.id}
              onKeyDown={keyDown(job)}
              onContextMenu={event => {
                event.preventDefault()
                setMenuOf(job.id)
              }}
              {...dragProps(job)}
            />
          </li>
        ))}
      </ul>
      {dialogs}
    </section>
  )
}
