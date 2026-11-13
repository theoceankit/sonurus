import { useHandleFormat, useModels, useQueue, useSetHandleFormat, useSetQueueStartMode } from '../../api/queries'
import type { HandleFormat, QueueStartMode } from '../../api/types'
import { Button } from '../../components/Button/Button'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { Inline } from '../../components/Inline/Inline'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { settingsStore, useSettings } from '../../platform/settings'
import { alignmentModel, LANGUAGES } from '../../transcribe/languages'
import { useModelDownloads } from '../../transcribe/model-downloads'
import { missingAlignmentModel } from '../../transcribe/models'
import styles from './Settings.module.css'

const START_MODES: { value: QueueStartMode; label: string }[] = [
  { value: 'auto', label: 'Automatically' },
  { value: 'manual', label: 'Manually' },
]

// Each format by the handle it makes of one name.
const HANDLE_FORMATS: { value: HandleFormat; label: string }[] = [
  { value: 'first.last', label: '@olivia.brown' },
  { value: 'f.last', label: '@o.brown' },
  { value: 'first.l', label: '@olivia.b' },
]


// The default language of new transcriptions, with the download of its alignment
// model while that is missing: without it a job in the language fails.
function TranscriptionLanguage({ language }: { language: string }) {
  const models = useModels().data
  const downloads = useModelDownloads()
  const missing = models ? missingAlignmentModel(language, models) : null
  const download = missing ? downloads.download(missing.id) : null
  const options = LANGUAGES.map(({ code, label }) => ({ value: code, label }))
  // A saved language that is not in the list (older versions had more) is still shown.
  if (!LANGUAGES.some(({ code }) => code === language)) options.push({ value: language, label: alignmentModel(language).name })
  const note = missing && (
    <Inline gap={2} justify="between" role="status" className={styles.languageNotice}>
      <span>
        Alignment model for {alignmentModel(missing.id).name} is not installed
        {download && ` — downloading ${Math.round(download.pct)}%`}
      </span>
      {download
        ? <Button variant="ghost" size="small" onClick={() => void downloads.cancel(missing.id)}>Cancel</Button>
        : <Button variant="secondary" size="small" icon="download" onClick={() => void downloads.start(missing.id)}>{`Download (${missing.size})`}</Button>}
    </Inline>
  )
  return (
    <FieldRow label="Transcription language" hint="Whisper detects it from the audio when set to Detect automatically." note={note || undefined}>
      <Select
        aria-label="Transcription language"
        value={language}
        options={options}
        onValueChange={value => void settingsStore().patch({ transcribeLang: value })}
      />
    </FieldRow>
  )
}

// Kept by the backend with the queue, not in the settings file.
function StartTranscription() {
  const queue = useQueue().data
  const { mutate } = useSetQueueStartMode()
  return (
    <FieldRow
      label="Start transcription"
      hint="Automatically: new imports are transcribed right away. Manually: they wait until you press Start in the queue."
    >
      <Select
        aria-label="Start transcription"
        value={queue?.start_mode ?? ''}
        placeholder="Loading…"
        options={START_MODES}
        disabled={!queue}
        onValueChange={value => mutate(value as QueueStartMode)}
      />
    </FieldRow>
  )
}

// Kept by the backend, which makes the handles.
function HandleFormatField() {
  const format = useHandleFormat().data
  const { mutate } = useSetHandleFormat()
  return (
    <FieldRow
      label="Handle format"
      hint="How a new speaker's handle is made from the name. Handles already given stay."
    >
      <Select
        aria-label="Handle format"
        value={format ?? ''}
        placeholder="Loading…"
        options={HANDLE_FORMATS}
        disabled={!format}
        onValueChange={value => mutate(value as HandleFormat)}
      />
    </FieldRow>
  )
}

export function GeneralSection() {
  const settings = useSettings()
  if (!settings) return null
  return (
    <>
      <SectionCard title="Transcription">
        <TranscriptionLanguage language={settings.transcribeLang} />
        <StartTranscription />
      </SectionCard>
      <SectionCard title="Speakers">
        <HandleFormatField />
      </SectionCard>
    </>
  )
}
