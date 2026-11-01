import { useQueueEventsSync } from './api/queries'
import { Button } from './components/Button/Button'
import { Icon } from './components/Icon/Icon'
import { Inline } from './components/Inline/Inline'

export function App() {
  useQueueEventsSync()
  return (
    <Inline as="main" gap={2} padding={4}>
      <Icon name="sparkle" />
      <Button variant="primary">New UI</Button>
    </Inline>
  )
}
