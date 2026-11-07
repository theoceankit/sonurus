import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { queryKeys, useQueue } from '../../api/queries'
import { Button } from '../../components/Button/Button'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { toast } from '../../components/Toast/toast-store'
import { Tooltip } from '../../components/Tooltip/Tooltip'
import { DEFAULT_SETTINGS, settingsStore } from '../../platform/settings'
import { useLingering } from '../../presence'
import { ConfirmDialog, type ConfirmPrompt } from './ConfirmDialog'
import { dataResetBlockReason, defaultSettingsPatch, formatDataResetSummary } from './data-reset'
import styles from './Settings.module.css'

type Step = { prompt: ConfirmPrompt; run: () => Promise<void> }

const RESET: ConfirmPrompt = {
  title: 'Reset preferences?',
  body: 'Every preference in Settings goes back to its default: automatic language detection, 100% scale and the default model. '
    + 'Transcripts, downloaded models, recordings and your HuggingFace token are kept.',
  confirmLabel: 'Reset',
}

const DELETE_ALL: ConfirmPrompt = {
  title: 'Delete all data?',
  body: 'All transcripts, all speakers and their voice profiles and the recordings made in Sonorus are deleted. '
    + 'This cannot be undone. Audio files you imported stay where they are; downloaded models and preferences are kept.',
  confirmLabel: 'Delete everything',
}

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

export function DataSection() {
  const api = useApi()
  const queries = useQueryClient()
  const queue = useQueue().data
  const [step, setStep] = useState<Step | null>(null)
  const confirmation = useLingering(step)
  const blocked = dataResetBlockReason(!!queue?.running_job_id)

  const reset = async () => {
    await settingsStore().patch(defaultSettingsPatch(DEFAULT_SETTINGS))
    await bridge()?.setZoom(DEFAULT_SETTINGS.scale / 100).catch(() => {})
    toast({ message: 'Preferences reset to defaults.' })
  }

  const deleteAll = async () => {
    try {
      const summary = await api.resetData()
      toast({ message: formatDataResetSummary(summary) })
    } catch (error) {
      toast({ message: `Could not delete data: ${(error as Error).message}`, type: 'error' })
    }
    await Promise.all([
      queries.invalidateQueries({ queryKey: queryKeys.transcripts }),
      queries.invalidateQueries({ queryKey: queryKeys.speakers }),
      queries.invalidateQueries({ queryKey: queryKeys.queue }),
    ])
  }

  const deleteButton = <Button variant="danger" size="small" disabled={!!blocked} onClick={() => setStep({ prompt: DELETE_ALL, run: deleteAll })}>Delete</Button>
  return (
    <>
      <SectionCard title="Reset to defaults">
        <FieldRow label="Reset preferences" hint="Transcripts, downloaded models, recordings and your HuggingFace token are kept.">
          <Button variant="secondary" size="small" onClick={() => setStep({ prompt: RESET, run: reset })}>Reset</Button>
        </FieldRow>
      </SectionCard>
      <SectionCard title="Delete all data">
        <FieldRow label="Start over with an empty library" hint="Deletes every transcript, speaker and recording made in Sonorus. This cannot be undone.">
          {blocked
            // A disabled button gets no pointer events: the tooltip hangs on a wrapper.
            ? <Tooltip text={blocked}><span className={styles.blocked} tabIndex={0} aria-label={`Delete all data: ${blocked}`}>{deleteButton}</span></Tooltip>
            : deleteButton}
        </FieldRow>
      </SectionCard>
      {confirmation.value && (
        <ConfirmDialog
          key={confirmation.key}
          prompt={confirmation.value.prompt}
          open={confirmation.open}
          onConfirm={confirmation.value.run}
          onClose={() => setStep(null)}
          onExited={confirmation.exited}
        />
      )}
    </>
  )
}
