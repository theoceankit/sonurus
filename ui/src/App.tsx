import { useEffect } from 'react'
import { useBackendConnected, useQueueEventsSync } from './api/queries'
import { toast } from './components/Toast/toast'
import { EditorScreen } from './screens/Editor/EditorScreen'

// What is on the screen stays, so this is the only sign that it may be out of date.
function useBackendLostToast() {
  const connected = useBackendConnected()
  useEffect(() => {
    if (!connected) return toast({ message: 'Backend is not responding', type: 'error', duration: Infinity })
  }, [connected])
}

export function App() {
  useQueueEventsSync()
  useBackendLostToast()
  return <EditorScreen />
}
