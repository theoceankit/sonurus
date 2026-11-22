import { Button } from '../components/Button/Button'
import { FieldRow } from '../components/FieldRow/FieldRow'
import { Toggle } from '../components/Toggle/Toggle'

export interface IdentifySpeakersProps {
  checked: boolean
  // The diarization model is installed. Without it the switch can only go off.
  available: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  onOpenSettings?: (section: 'models') => void
}

// Whether a run looks for speakers. Without the model the run still goes, as text alone.
export function IdentifySpeakers({ checked, available, disabled = false, onChange, onOpenSettings }: IdentifySpeakersProps) {
  return (
    <FieldRow
      label="Identify speakers"
      hint={available ? undefined : 'Needs the diarization model'}
      note={available ? undefined : (
        <Button variant="ghost" size="small" icon="settings" onClick={() => onOpenSettings?.('models')}>Download in Settings</Button>
      )}
    >
      <Toggle label="Identify speakers" checked={checked} disabled={disabled || (!available && !checked)} onChange={onChange} />
    </FieldRow>
  )
}
