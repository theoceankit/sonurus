import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Toggle } from '../../components/Toggle/Toggle'
import { markNotImplemented } from '../../not-implemented'
import type { ElectronSettings } from '../../platform/electron-api'
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../../platform/settings'

const INCLUDE = [
  { key: 'exportTimestamps', label: 'Timestamps', hint: undefined },
  { key: 'exportSpeakers', label: 'Speaker labels', hint: undefined },
  { key: 'exportNotes', label: 'Notes', hint: 'The note of the recording, at the end.' },
] as const

const patch = (change: Partial<ElectronSettings>) => void settingsStore().patch(change)

// The format is picked each time, in the menu of Export in the transcript header.
export function ExportSection() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  return (
    <SectionCard title="Export" description="What goes into an export.">
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
