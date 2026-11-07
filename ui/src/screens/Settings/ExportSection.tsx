import { useState } from 'react'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { Toggle } from '../../components/Toggle/Toggle'
import { markNotImplemented } from '../../not-implemented'

// Export is not there yet: the titlebar copy is always plain text. The section is
// shown, marked as not available, as in the old UI.
const FORMATS = [
  { value: 'txt', label: 'Plain text', meta: '.txt' },
  { value: 'md', label: 'Markdown', meta: '.md' },
  { value: 'srt', label: 'SubRip', meta: '.srt' },
  { value: 'vtt', label: 'WebVTT', meta: '.vtt' },
  { value: 'json', label: 'JSON', meta: '.json' },
]

const INCLUDE = [
  { key: 'timestamps', label: 'Timestamps', on: true },
  { key: 'speakers', label: 'Speaker labels', on: true },
  { key: 'bookmarks', label: 'Bookmarks', on: false },
  { key: 'audio', label: 'Original audio file', on: false },
]

export function ExportSection() {
  const [format] = useState('txt')
  return (
    <div {...markNotImplemented('settings.export')}>
      <SectionCard title="Export" description="Default format and what goes into an export.">
        <FieldRow label="Default format" hint="Used when exporting without picking a format.">
          <Select aria-label="Default format" value={format} options={FORMATS} onValueChange={() => {}} />
        </FieldRow>
        <FieldRow label="Duplicate on export" hint="Keeps the original and writes a copy.">
          <Toggle label="Duplicate on export" checked />
        </FieldRow>
        {INCLUDE.map(({ key, label, on }) => (
          <FieldRow key={key} label={label} hint={key === 'timestamps' ? 'What every export format includes.' : undefined}>
            <Toggle label={label} checked={on} />
          </FieldRow>
        ))}
      </SectionCard>
    </div>
  )
}
