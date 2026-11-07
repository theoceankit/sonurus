import { useCallback, useEffect, useState } from 'react'
import { useCaptureSources } from '../api/queries'
import { settingsStore, useSettings } from '../platform/settings'
import { useInputDevices } from './devices'
import { useRecording } from './RecordingProvider'
import type { RecordingRequest } from './session'
import {
  DEFAULT_MIC, NO_SYSTEM_AUDIO, micOptions, pickDevice, sourceSetting, sourcesOf, startBlockReason, systemOptions,
  type DeviceOption, type RecordingSources,
} from './sources'

type Picks = { sources: RecordingSources | null; mic: string | null; system: string | null }
const NOTHING: Picks = { sources: null, mic: null, system: null }

export type RecordingSetup = {
  sources: RecordingSources
  onToggle: (source: keyof RecordingSources) => void
  micDevices: DeviceOption[]
  micDevice: string | null
  onMicDeviceChange: (device: string) => void
  systemDevices: DeviceOption[]
  systemDevice: string | null
  onSystemDeviceChange: (device: string) => void
  // Why system audio cannot be recorded here; undefined while it can, and while asking.
  systemUnavailable?: string
  // A recording is in progress: this one cannot start.
  recording: boolean
  // Why Start recording is off, or null.
  blocked: string | null
}

// What the New recording dialog records with: the sources and devices saved last,
// changed for this run until it starts. While `active` (the dialog is open) it lists
// the devices again, as they may have changed.
export function useRecordingSetup(active: boolean) {
  const settings = useSettings()
  const recording = useRecording()
  const capture = useCaptureSources(active)
  const inputs = useInputDevices(active)
  const [picks, setPicks] = useState<Picks>(NOTHING)

  // Each opening starts from what is saved.
  useEffect(() => { if (active) setPicks(NOTHING) }, [active])

  const micDevices = micOptions(inputs)
  const systemDevices = systemOptions(capture.data ?? [])
  const systemAvailable = systemDevices.length > 0
  const sources = picks.sources ?? sourcesOf(settings?.recordingAudioSource)
  const micDevice = pickDevice(picks.mic ?? settings?.recordingMicDevice ?? DEFAULT_MIC, micDevices)
  const systemDevice = pickDevice(picks.system ?? settings?.recordingSystemDevice ?? null, systemDevices)
  const busy = recording.phase !== 'idle'

  const setup: RecordingSetup = {
    sources,
    onToggle: source => setPicks(current => ({ ...current, sources: { ...sources, [source]: !sources[source] } })),
    micDevices,
    micDevice,
    onMicDeviceChange: mic => setPicks(current => ({ ...current, mic })),
    systemDevices,
    systemDevice,
    onSystemDeviceChange: system => setPicks(current => ({ ...current, system })),
    systemUnavailable: capture.isSuccess && !systemAvailable ? NO_SYSTEM_AUDIO : undefined,
    recording: busy,
    blocked: startBlockReason({ sources, systemAvailable, recording: busy }),
  }

  // Saves the sources and devices as the defaults and starts recording. False when it
  // may not start.
  const { start: startRecording } = recording
  const start = useCallback((run: Pick<RecordingRequest, 'title' | 'model' | 'language'>): boolean => {
    if (setup.blocked) return false
    const setting = sourceSetting(sources)
    if (!setting) return false
    void settingsStore().patch({
      recordingAudioSource: setting,
      recordingMicDevice: micDevice === DEFAULT_MIC ? null : micDevice,
      recordingSystemDevice: systemDevice,
    })
    startRecording({
      ...run,
      mic: sources.mic,
      micDeviceId: micDevice === DEFAULT_MIC ? null : micDevice,
      system: sources.system && systemAvailable,
      systemSourceId: systemAvailable ? systemDevice : null,
    })
    return true
  }, [setup.blocked, sources, micDevice, systemDevice, systemAvailable, startRecording])

  return { setup, start }
}
