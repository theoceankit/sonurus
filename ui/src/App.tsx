import { useEffect } from 'react'
import { useBackendConnected, useQueueEventsSync } from './api/queries'
import { toast } from './components/Toast/toast-store'
import { EditorScreen } from './screens/Editor/EditorScreen'
import { AlignmentDialog } from './screens/Queue/AlignmentDialog'
import { useAlignmentDialogs } from './screens/Queue/useAlignmentDialogs'

// What is on the screen stays, so this is the only sign that it may be out of date.
function useBackendLostToast() {
  const connected = useBackendConnected()
  useEffect(() => {
    if (!connected) return toast({ message: 'Backend is not responding', type: 'error', duration: Infinity })
  }, [connected])
}

export function App() {
  const alignment = useAlignmentDialogs()
  useQueueEventsSync(alignment.onQueueEvent)
  useBackendLostToast()
  return (
    <>
      <EditorScreen />
      {alignment.dialog && <AlignmentDialog key={alignment.dialog.language} {...alignment.dialog} />}
    </>
  )
}
