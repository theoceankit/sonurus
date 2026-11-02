import { useQueueEventsSync } from './api/queries'
import { EditorScreen } from './screens/Editor/EditorScreen'

export function App() {
  useQueueEventsSync()
  return <EditorScreen />
}
