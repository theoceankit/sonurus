import { useModels } from '../../api/queries'
import type { ModelInfo } from '../../api/types'
import { Icon } from '../../components/Icon/Icon'
import { Inline } from '../../components/Inline/Inline'
import { ModelRow, type ModelRowState } from '../../components/ModelRow/ModelRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { useSettings } from '../../platform/settings'
import { selectTranscribeModel } from '../../platform/transcribe-defaults'
import { useLingering } from '../../presence'
import { ConfirmDialog } from './ConfirmDialog'
import { useModelDelete } from './model-delete-action'
import { useModelDownloads, type ModelDownloads } from '../../transcribe/model-downloads'
import { modelState, settingsModelHint } from '../../transcribe/models'
import styles from './Settings.module.css'

type TranscriptionModel = Extract<ModelInfo, { kind: 'whisper' | 'diarization' }>

// What a row shows of a model: installed per GET /models, downloading or failed per
// the downloads of the app (GET /models knows of neither).
export function rowState(installed: boolean, modelId: string, downloads: ModelDownloads): { state: ModelRowState; pct?: number; error?: string } {
  if (installed) return { state: 'installed' }
  const download = downloads.download(modelId)
  if (download) return { state: 'downloading', pct: download.pct }
  const error = downloads.error(modelId)
  return error ? { state: 'failed', error } : { state: 'available' }
}

export function Loading({ models }: { models: ReturnType<typeof useModels> }) {
  return <p className={styles.quiet}>{models.isError ? 'The transcription service does not answer.' : 'Checking models…'}</p>
}

export function ModelsSection() {
  const models = useModels()
  const settings = useSettings()
  const downloads = useModelDownloads()
  const deletion = useModelDelete()
  const confirmation = useLingering(deletion.toConfirm)
  if (!models.data || !settings) return <Loading models={models} />
  const state = modelState(models.data, settings)
  const hint = settingsModelHint(state)
  const rows = models.data.filter((model): model is TranscriptionModel => model.kind !== 'alignment')
  const row = (model: TranscriptionModel) => {
    const isDefault = model.kind === 'whisper' && model.installed && state.model === model.id
    return (
      <ModelRow
        key={model.id}
        icon={model.kind === 'whisper' ? 'whisper-model' : 'diarization-model'}
        name={model.name}
        // The size and the speed; a model without a speed of its own (diarization) shows "—".
        meta={[model.size, model.speed].filter(item => item && item !== '—')}
        {...rowState(model.installed, model.id, downloads)}
        selected={isDefault}
        onDownload={() => void downloads.start(model.id)}
        onCancel={() => void downloads.cancel(model.id)}
        onUse={model.kind === 'whisper' ? () => void selectTranscribeModel(model.id) : undefined}
        onDelete={() => deletion.request(model, model.name)}
        deleteBlocked={deletion.blocked(model)}
      />
    )
  }
  return (
    <>
      {hint && (
        <Inline gap={2} role="status" className={styles.languageNotice}>
          <Icon name="alert" />
          <span>{hint}</span>
        </Inline>
      )}
      <SectionCard title="Transcription" description="Whisper turns speech into text. The default one is used for new transcriptions.">
        {rows.filter(model => model.kind === 'whisper').map(row)}
      </SectionCard>
      <SectionCard title="Speaker diarization" description="Tells the speakers apart. Every transcription needs it.">
        {rows.filter(model => model.kind === 'diarization').map(row)}
      </SectionCard>
      {confirmation.value && (
        <ConfirmDialog
          key={confirmation.key}
          prompt={confirmation.value.prompt}
          open={confirmation.open}
          onConfirm={deletion.confirm}
          onClose={deletion.close}
          onExited={confirmation.exited}
        />
      )}
    </>
  )
}
