import { useCallback, useEffect, useState } from 'react'
import { useBackendConnected, useQueueEventsSync } from './api/queries'
import type { QueueUpdate } from './api/types'
import { toast } from './components/Toast/toast-store'
import { EditorScreen, type RecordingRequest } from './screens/Editor/EditorScreen'
import { AlignmentDialog } from './screens/Queue/AlignmentDialog'
import { queueEventToast } from './screens/Queue/queue-toasts'
import { useAlignmentDialogs } from './screens/Queue/useAlignmentDialogs'
import { SettingsProvider } from './screens/Settings/SettingsProvider'
import { useGpu } from './settings/gpu'
import { useDefaultModelSync } from './transcribe/default-model-sync'

// What is on the screen stays, so this is the only sign that it may be out of date.
// Not while the app restarts the backend itself to apply GPU acceleration.
function useBackendLostToast() {
  const connected = useBackendConnected()
  const { restarting } = useGpu().state
  useEffect(() => {
    if (!connected && !restarting) return toast({ message: 'Backend is not responding', type: 'error', duration: Infinity })
  }, [connected, restarting])
}

function Screens() {
  const alignment = useAlignmentDialogs()
  // A new object each time, so Open opens the recording again after the user left it.
  const [opening, setOpening] = useState<RecordingRequest | null>(null)
  const { onQueueEvent: alignmentEvent } = alignment
  const onQueueEvent = useCallback((event: QueueUpdate) => {
    alignmentEvent(event)
    const shown = queueEventToast(event, id => setOpening({ id }))
    if (shown) toast(shown)
  }, [alignmentEvent])
  useQueueEventsSync(onQueueEvent)
  useBackendLostToast()
  useDefaultModelSync()
  return (
    <>
      <EditorScreen openRequest={opening} />
      {alignment.dialog && <AlignmentDialog key={alignment.dialog.language} {...alignment.dialog} />}
    </>
  )
}

export function App() {
  return <SettingsProvider><Screens /></SettingsProvider>
}
