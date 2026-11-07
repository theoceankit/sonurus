import type { AudioSource } from '../api/types'
import type { DeviceOption } from '../components/SourceToggle/SourceToggle'
import type { ElectronSettings } from '../platform/electron-api'

// What a live recording takes, the two buttons of the New recording dialog.
export type RecordingSources = { mic: boolean; system: boolean }
export type SourceSetting = ElectronSettings['recordingAudioSource']

// A device in a menu: an input's deviceId or a backend source id.
export type { DeviceOption }

// The default microphone. Saved as null, as the old UI does.
export const DEFAULT_MIC = 'default-microphone'

export const BOTH_OFF = 'Turn on the microphone or system audio to record.'
export const NO_SYSTEM_AUDIO = 'No system audio can be recorded on this computer'

export function sourcesOf(setting: SourceSetting | undefined): RecordingSources {
  if (setting === 'mic') return { mic: true, system: false }
  if (setting === 'system') return { mic: false, system: true }
  return { mic: true, system: true }
}

// Null with both off: there is nothing to save, and nothing starts.
export function sourceSetting({ mic, system }: RecordingSources): SourceSetting | null {
  if (mic && system) return 'both'
  if (mic) return 'mic'
  if (system) return 'system'
  return null
}

// The labels are empty until the window may use the microphone, so the dialog asks
// for it before it lists the inputs.
export function micOptions(devices: readonly MediaDeviceInfo[]): DeviceOption[] {
  return [
    { value: DEFAULT_MIC, label: 'Default microphone' },
    ...devices
      .filter(device => device.kind === 'audioinput')
      .map(device => ({ value: device.deviceId, label: device.label || `Microphone ${device.deviceId.slice(0, 6)}` })),
  ]
}

// The backend names each source after its output device, the default output first.
export const systemOptions = (sources: readonly AudioSource[]): DeviceOption[] =>
  sources.map(({ id, label }) => ({ value: id, label }))

// The saved device while it is there, else the first one; null with no devices at all.
export function pickDevice(saved: string | null, options: readonly DeviceOption[]): string | null {
  if (saved && options.some(option => option.value === saved)) return saved
  return options[0]?.value ?? null
}

// Why Start recording is off, or null when a recording may start. System audio that
// cannot be captured does not count as a source.
export function startBlockReason({ sources, systemAvailable, recording }: {
  sources: RecordingSources
  systemAvailable: boolean
  recording: boolean
}): string | null {
  if (recording) return 'A recording is already in progress'
  if (!sources.mic && !(sources.system && systemAvailable)) return BOTH_OFF
  return null
}

// The backend's reason a capture did not start; on macOS a refusal of the system says
// where to allow it.
export function captureStartError(platform: string, detail: string): string {
  const message = detail || 'Failed to start system audio capture.'
  if (platform === 'darwin' && /permission|denied|SCStream|TCC|Screen Recording/i.test(message)) {
    return 'Screen Recording access is required. Open System Settings → Privacy & Security → Screen Recording and enable Sonorus, then try again.'
  }
  return message
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
