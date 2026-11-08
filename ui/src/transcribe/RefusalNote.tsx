import { Button } from '../components/Button/Button'
import { Stack } from '../components/Stack/Stack'
import type { Refusal } from './refusals'
import styles from './RefusalNote.module.css'

// The backend's refusal in a window, above its buttons, with the way to Settings
// when a model is missing.
export function RefusalNote({ refusal, onOpenSettings }: { refusal: Refusal; onOpenSettings?: (section: 'models' | 'alignment') => void }) {
  const section = refusal.settingsSection
  return (
    <Stack gap={1} align="start" role="alert" className={styles.note}>
      <span>{refusal.message}</span>
      {section && (
        <Button variant="ghost" size="small" icon="settings" onClick={() => onOpenSettings?.(section)}>Open Settings</Button>
      )}
    </Stack>
  )
}
