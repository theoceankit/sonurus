import type { IconName } from '../../components/Icon/icon-names'

// The sections of Settings, in the order of the column at its side.
export const SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'models', label: 'Models', icon: 'models' },
  { id: 'alignment', label: 'Alignment', icon: 'alignment' },
  { id: 'gpu', label: 'GPU', icon: 'sparkle' },
  { id: 'apiKeys', label: 'API Keys', icon: 'api-keys' },
  { id: 'export', label: 'Export', icon: 'export' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[]

export type SettingsSection = (typeof SECTIONS)[number]['id']

export const FIRST_SECTION: SettingsSection = SECTIONS[0].id

// The version line under the sections; the version comes from package.json.
export function formatAppVersion(version: unknown): string {
  const v = typeof version === 'string' ? version.trim() : ''
  return v && v !== 'unknown' ? `Sonorus ${v}` : 'Sonorus'
}
