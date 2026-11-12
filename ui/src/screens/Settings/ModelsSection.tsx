import type { ReactNode } from 'react'
import { useModels, useModelsFolder } from '../../api/queries'
import type { ModelInfo } from '../../api/types'
import { Icon } from '../../components/Icon/Icon'
import { Inline } from '../../components/Inline/Inline'
import { ModelRow, type ModelRowState } from '../../components/ModelRow/ModelRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { toast } from '../../components/Toast/toast-store'
import { Tooltip } from '../../components/Tooltip/Tooltip'
import { useSettings } from '../../platform/settings'
import { selectTranscribeModel } from '../../platform/transcribe-defaults'
import { useLingering } from '../../presence'
import { ConfirmDialog } from './ConfirmDialog'
import { useModelDelete } from './model-delete-action'
import { useModelDownloads, type ModelDownloads } from '../../transcribe/model-downloads'
import { modelState, settingsModelHint } from '../../transcribe/models'
import { downloadFailureText, type DownloadFailure } from '../../transcribe/download-errors'
import { useSettingsDialog } from './SettingsProvider'
import styles from './Settings.module.css'

type TranscriptionModel = Extract<ModelInfo, { kind: 'whisper' | 'diarization' }>

// Why a download failed, with a link to API Keys where the token is the reason.
export function DownloadFailureText({ failure }: { failure: DownloadFailure }) {
  const settingsDialog = useSettingsDialog()
  const { text, apiKeys } = downloadFailureText(failure)
  if (!apiKeys) return <>{text}</>
  return <>{text}{' '}<button type="button" className={styles.link} onClick={() => settingsDialog.open('apiKeys')}>API Keys</button>.</>
}

// What a row shows of a model: installed per GET /models, downloading or failed per
// the downloads of the app (GET /models knows of neither).
export function rowState(installed: boolean, modelId: string, downloads: ModelDownloads): { state: ModelRowState; pct?: number; error?: ReactNode } {
  if (installed) return { state: 'installed' }
  const download = downloads.download(modelId)
  if (download) return { state: 'downloading', pct: download.pct }
  const failure = downloads.failure(modelId)
  return failure ? { state: 'failed', error: <DownloadFailureText failure={failure} /> } : { state: 'available' }
}

export function Loading({ models }: { models: ReturnType<typeof useModels> }) {
  return <p className={styles.quiet}>{models.isError ? 'The transcription service does not answer.' : 'Checking models…'}</p>
}

// The last part of a path, on any OS: .models of the data directory.
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

// Where the backend keeps every model, on a line of its own under a card's
// description: the folder by its name, the whole path in the tooltip. The name
// opens the folder; main opens the folder the backend names, the window passes
// no path. Before the first download there is no folder to open, and the name is
// only text.
export function ModelsFolderLine() {
  const folder = useModelsFolder().data
  if (!folder) return null
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
  const show = async () => {
    const error = await bridge!.showModelsFolder()
    if (error) toast({ message: `Could not open the models folder: ${error}`, type: 'error' })
  }
  const name = folderName(folder.path)
  const opens = folder.exists && !!bridge
  return (
    <span className={styles.folderLine}>
      {folder.exists ? 'Every downloaded model is kept in the ' : 'Downloaded models will be kept in the '}
      <Tooltip text={folder.path}>
        {opens
          ? <button type="button" className={styles.link} onClick={() => void show()}>{name}</button>
          // Focusable, so the keyboard reaches the path in the tooltip too.
          : <span className={styles.folderName} tabIndex={0}>{name}</span>}
      </Tooltip>
      {' folder.'}
    </span>
  )
}

export function ModelsSection() {
  const models = useModels()
  const settings = useSettings()
  const downloads = useModelDownloads()
  const settingsDialog = useSettingsDialog()
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
      <SectionCard
        title="Transcription"
        description={<>Whisper turns speech into text. The default one is used for new transcriptions.<ModelsFolderLine /></>}
      >
        {rows.filter(model => model.kind === 'whisper').map(row)}
      </SectionCard>
      <SectionCard
        title="Speaker diarization"
        description={(
          <>
            Tells the speakers apart. Every transcription needs it. Its download needs a HuggingFace token, set in{' '}
            <button type="button" className={styles.link} onClick={() => settingsDialog.open('apiKeys')}>API Keys</button>.
          </>
        )}
      >
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
