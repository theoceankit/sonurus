import { Button } from '../../components/Button/Button'
import { Inline } from '../../components/Inline/Inline'
import { Select } from '../../components/Select/Select'
import type { TranscribeChoice } from '../../transcribe/choice'
import { blockMessage } from '../../transcribe/models'
import styles from './TranscribeFields.module.css'

type SettingsSection = 'models' | 'alignment'

export interface TranscribeFieldsProps {
  choice: TranscribeChoice
  onModelChange: (model: string) => void
  onLanguageChange: (language: string) => void
  // While the run is being sent: nothing can be changed.
  disabled?: boolean
}

// What New recording and Import files share: the model and the language of this run.
export function TranscribeFields({ choice, onModelChange, onLanguageChange, disabled = false }: TranscribeFieldsProps) {
  return (
    <Inline gap={3} align="start">
      <Select
        label="Model"
        value={choice.model ?? ''}
        options={choice.modelOptions}
        placeholder={choice.checking ? 'Checking models…' : 'No model installed'}
        disabled={choice.checking || disabled}
        onValueChange={onModelChange}
      />
      <Select
        label="Language"
        value={choice.language}
        options={choice.languageOptions}
        placeholder="Checking…"
        disabled={!choice.language || disabled}
        onValueChange={onLanguageChange}
      />
    </Inline>
  )
}

// Which model the run is missing, with the way to download it: Settings over the
// dialog, on the section where it is. Nothing while none is missing.
export function MissingModelNotice({ choice, onOpenSettings }: { choice: TranscribeChoice; onOpenSettings?: (section: SettingsSection) => void }) {
  if (!choice.blocked) return null
  const section: SettingsSection = choice.blocked.missing === 'alignment' ? 'alignment' : 'models'
  return (
    <Inline gap={2} justify="between" role="status" className={styles.blockedNotice}>
      <span>{blockMessage(choice.blocked)}</span>
      <Button variant="ghost" size="small" icon="settings" onClick={() => onOpenSettings?.(section)}>Download in Settings</Button>
    </Inline>
  )
}
