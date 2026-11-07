import { useCaptureSources } from '../../api/queries'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { settingsStore, useSettings } from '../../platform/settings'
import { useInputDevices } from '../../recording/devices'
import { DEFAULT_MIC, micOptions, pickDevice, systemOptions } from '../../recording/sources'

// The devices a new recording starts with. New recording saves here what it starts
// with, so the two always show the same.
export function AudioSection() {
  const settings = useSettings()
  const inputs = useInputDevices(true)
  const capture = useCaptureSources()
  if (!settings) return null
  const mics = micOptions(inputs)
  const systems = systemOptions(capture.data ?? [])
  const none = capture.isSuccess && systems.length === 0
  return (
    <SectionCard title="Live recording" description="The devices a new recording starts with. New recording can change them for its run.">
      <FieldRow label="Microphone" hint="Recorded during a live recording.">
        <Select
          aria-label="Microphone"
          value={pickDevice(settings.recordingMicDevice ?? DEFAULT_MIC, mics) ?? DEFAULT_MIC}
          options={mics}
          onValueChange={value => void settingsStore().patch({ recordingMicDevice: value === DEFAULT_MIC ? null : value })}
        />
      </FieldRow>
      <FieldRow label="System audio source" hint="The output whose sound is recorded: calls, the browser, apps.">
        <Select
          aria-label="System audio source"
          value={pickDevice(settings.recordingSystemDevice, systems) ?? ''}
          options={systems}
          placeholder={none ? 'Not available' : 'Checking…'}
          disabled={systems.length === 0}
          onValueChange={value => void settingsStore().patch({ recordingSystemDevice: value })}
        />
      </FieldRow>
    </SectionCard>
  )
}
