import { useEffect, useState } from 'react'
import { useModels, useQueue, useSetQueueStartMode } from '../../api/queries'
import type { QueueStartMode } from '../../api/types'
import { Button } from '../../components/Button/Button'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { Inline } from '../../components/Inline/Inline'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { Slider } from '../../components/Slider/Slider'
import { markNotImplemented } from '../../not-implemented'
import { settingsStore, useSettings } from '../../platform/settings'
import { alignmentModel, LANGUAGES } from '../../transcribe/languages'
import { useModelDownloads } from '../../transcribe/model-downloads'
import { missingAlignmentModel } from '../../transcribe/models'
import styles from './Settings.module.css'

export const SCALE = { min: 50, max: 200, step: 5 }
const SCALE_MARKS = [50, 100, 150, 200].map(value => ({ value, label: `${value}%` }))

const START_MODES: { value: QueueStartMode; label: string }[] = [
  { value: 'auto', label: 'Automatically' },
  { value: 'manual', label: 'Manually' },
]

const INTERFACE_LANGUAGES = LANGUAGES.filter(({ code }) => code !== 'auto').map(({ code, label }) => ({ value: code, label }))

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

// The slider follows the pointer; the zoom and the file change once it lets go.
function InterfaceScale({ saved }: { saved: number }) {
  const [scale, setScale] = useState(saved)
  useEffect(() => setScale(saved), [saved])
  const commit = (value: number) => {
    void bridge()?.setZoom(value / 100).catch(() => {})
    void settingsStore().patch({ scale: value })
  }
  return (
    <FieldRow label="Interface scale" hint="Affects type sizes and spacing." stacked>
      <Inline gap={3} align="start" className={styles.scale}>
        <Slider
          label="Interface scale"
          orientation="horizontal"
          {...SCALE}
          value={scale}
          onChange={setScale}
          onCommit={commit}
          marks={SCALE_MARKS}
          valueText={value => `${value}%`}
        />
        <span className={styles.scaleValue} aria-hidden>{scale}%</span>
      </Inline>
    </FieldRow>
  )
}

// The default language of new transcriptions, with the download of its alignment
// model while that is missing: without it a job in the language fails.
function TranscriptionLanguage({ language }: { language: string }) {
  const models = useModels().data
  const downloads = useModelDownloads()
  const missing = models ? missingAlignmentModel(language, models) : null
  const download = missing ? downloads.download(missing.id) : null
  const options = LANGUAGES.map(({ code, label }) => ({ value: code, label }))
  // A saved language that is not in the list (the old UI has more) is still shown.
  if (!LANGUAGES.some(({ code }) => code === language)) options.push({ value: language, label: alignmentModel(language).name })
  const note = missing && (
    <Inline gap={2} justify="between" role="status" className={styles.languageNotice}>
      <span>
        Alignment model for {alignmentModel(missing.id).name} is not installed
        {download && ` — downloading ${Math.round(download.pct)}%`}
      </span>
      {download
        ? <Button variant="ghost" size="small" onClick={() => void downloads.cancel(missing.id)}>Cancel</Button>
        : <Button variant="secondary" size="small" icon="download" onClick={() => void downloads.start(missing.id)}>{`Download (${alignmentModel(missing.id).size})`}</Button>}
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

export function GeneralSection() {
  const settings = useSettings()
  if (!settings) return null
  return (
    <>
      <SectionCard title="Interface">
        <FieldRow label="App language" hint="Language used across menus and dialogs.">
          <div className={styles.fill} {...markNotImplemented('settings.app-language')}>
            <Select aria-label="App language" value="en" options={INTERFACE_LANGUAGES} onValueChange={() => {}} />
          </div>
        </FieldRow>
        <InterfaceScale saved={settings.scale} />
      </SectionCard>
      <SectionCard title="Transcription">
        <TranscriptionLanguage language={settings.transcribeLang} />
        <StartTranscription />
      </SectionCard>
    </>
  )
}
