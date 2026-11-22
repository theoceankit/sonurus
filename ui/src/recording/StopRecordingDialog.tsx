import { useEffect, useRef } from 'react'
import { Modal } from '../components/Modal/Modal'
import { ModalBody } from '../components/ModalBody/ModalBody'
import { ModalFooter } from '../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../components/ModalHeader/ModalHeader'
import { useRecording } from './RecordingProvider'

const WAIT_FOR_RECORDING_MS = 5000

interface StopRecordingDialogProps {
  open: boolean
  onClose: () => void
}

// Asked when a call seems to have ended (a click on the notification) or from the tray:
// stop the live recording and queue it, or keep recording. Goes by itself once the recording ends.
export function StopRecordingDialog({ open, onClose }: StopRecordingDialogProps) {
  const recording = useRecording()
  const live = recording.phase === 'live'
  // A window made for the click learns of the recording a moment after it opens: the
  // question waits that long for it, and goes at once when a recording it showed ends.
  const shown = useRef(false)
  useEffect(() => {
    if (!open) {
      shown.current = false
      return
    }
    if (live) {
      shown.current = true
      return
    }
    const timer = setTimeout(onClose, shown.current ? 0 : WAIT_FOR_RECORDING_MS)
    return () => clearTimeout(timer)
  }, [open, live, onClose])
  return (
    <Modal size="small" open={open && live} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Stop recording?" />
      <ModalBody>{`"${recording.title}" is still recording. Stop it and add it to the queue?`}</ModalBody>
      <ModalFooter
        cancel={{ children: 'Keep recording' }}
        confirm={{ children: 'Stop recording', onClick: () => { recording.stop(); onClose() } }}
      />
    </Modal>
  )
}
