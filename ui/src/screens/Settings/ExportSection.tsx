import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { Toggle } from '../../components/Toggle/Toggle'
import { markNotImplemented } from '../../not-implemented'
import type { ElectronSettings, ExportSpeakerLabel } from '../../platform/electron-api'
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../../platform/settings'

const SPEAKER_LABELS: { value: ExportSpeakerLabel; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'handle', label: 'Handle' },
]

const patch = (change: Partial<ElectronSettings>) => void settingsStore().patch(change)

// The format is picked each time, in the menu of Export in the transcript header.
export function ExportSection() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  return (
    <SectionCard title="Export" description="What goes into an export." undivided>
      <FieldRow label="Timestamps">
        <Toggle label="Timestamps" checked={settings.exportTimestamps} onChange={checked => patch({ exportTimestamps: checked })} />
      </FieldRow>
      <FieldRow label="Speaker labels">
        <Toggle label="Speaker labels" checked={settings.exportSpeakers} onChange={checked => patch({ exportSpeakers: checked })} />
      </FieldRow>
      <FieldRow label="Show speakers by" hint="A speaker without a handle keeps their label.">
        <Select
          aria-label="Show speakers by"
          value={settings.exportSpeakerLabel}
          options={SPEAKER_LABELS}
          disabled={!settings.exportSpeakers}
          onValueChange={value => patch({ exportSpeakerLabel: value as ExportSpeakerLabel })}
        />
      </FieldRow>
      <FieldRow label="Notes" hint="The note of the recording, at the end.">
        <Toggle label="Notes" checked={settings.exportNotes} onChange={checked => patch({ exportNotes: checked })} />
      </FieldRow>
      <FieldRow label="Bookmarks">
        <Toggle label="Bookmarks" checked={false} {...markNotImplemented('settings.export-bookmarks')} />
      </FieldRow>
      <FieldRow label="Original audio file">
        <Toggle label="Original audio file" checked={false} {...markNotImplemented('settings.export-audio')} />
      </FieldRow>
    </SectionCard>
  )
}
