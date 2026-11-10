import type { ReactNode } from 'react'
import { Button } from '../../components/Button/Button'
import { Inline } from '../../components/Inline/Inline'
import { Select } from '../../components/Select/Select'
import { markNotImplemented } from '../../not-implemented'
import type { TranscribeChoice } from '../../transcribe/choice'
import { blockMessage } from '../../transcribe/models'
import styles from './TranscribeFields.module.css'

export interface TranscribeFieldsProps {
  choice: TranscribeChoice
  onModelChange: (model: string) => void
  onLanguageChange: (language: string) => void
  // While the run is being sent: nothing can be changed.
  disabled?: boolean
  // Settings over the dialog, on the section where the missing model is downloaded.
  onOpenSettings?: (section: 'models' | 'alignment') => void
  // Between the model and language and Diarize speakers: the sources of a recording.
  children?: ReactNode
}

// What New recording and Import files share: the model and the language of this run,
// Diarize speakers, and which model is missing, with the way to download it.
export function TranscribeFields({ choice, onModelChange, onLanguageChange, disabled = false, onOpenSettings, children }: TranscribeFieldsProps) {
  return (
    <>
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
      {children}
      <Inline>
        <Button size="small" icon="add" {...markNotImplemented('new-transcription.diarize')}>Diarize speakers</Button>
      </Inline>
      {choice.blocked && (
        <Inline gap={2} justify="between" role="status" className={styles.blockedNotice}>
          <span>{blockMessage(choice.blocked)}</span>
          <Button variant="ghost" size="small" icon="settings" onClick={() => onOpenSettings?.(choice.blocked?.missing === 'alignment' ? 'alignment' : 'models')}>Download in Settings</Button>
        </Inline>
      )}
    </>
  )
}
