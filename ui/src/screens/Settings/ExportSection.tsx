import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { Toggle } from '../../components/Toggle/Toggle'
import { markNotImplemented } from '../../not-implemented'
import type { ElectronSettings, ExportFormat } from '../../platform/electron-api'
import { DEFAULT_SETTINGS, exportFormatOf, settingsStore, useSettings } from '../../platform/settings'

const FORMATS: { value: ExportFormat; label: string; meta: string }[] = [
  { value: 'txt', label: 'Plain text', meta: '.txt' },
  { value: 'md', label: 'Markdown', meta: '.md' },
  { value: 'json', label: 'JSON', meta: '.json' },
]

const INCLUDE = [
  { key: 'exportTimestamps', label: 'Timestamps', hint: undefined },
  { key: 'exportSpeakers', label: 'Speaker labels', hint: undefined },
  { key: 'exportNotes', label: 'Notes', hint: 'The note of the recording, at the end.' },
] as const

const patch = (change: Partial<ElectronSettings>) => void settingsStore().patch(change)

export function ExportSection() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  return (
    <SectionCard title="Export" description="Default format and what goes into an export.">
      <FieldRow label="Default format" hint="The save dialog starts on it. The extension of the file name decides.">
        <Select
          aria-label="Default format"
          value={exportFormatOf(settings.exportFormat)}
          options={FORMATS}
          onValueChange={value => patch({ exportFormat: value })}
        />
      </FieldRow>
      {INCLUDE.map(({ key, label, hint }) => (
        <FieldRow key={key} label={label} hint={hint}>
          <Toggle label={label} checked={settings[key]} onChange={checked => patch({ [key]: checked })} />
        </FieldRow>
      ))}
      <FieldRow label="Bookmarks">
        <Toggle label="Bookmarks" checked={false} {...markNotImplemented('settings.export-bookmarks')} />
      </FieldRow>
      <FieldRow label="Original audio file">
        <Toggle label="Original audio file" checked={false} {...markNotImplemented('settings.export-audio')} />
      </FieldRow>
    </SectionCard>
  )
}
