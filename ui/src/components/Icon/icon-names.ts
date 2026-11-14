// One entry per file in assets/icons; Icon.test.tsx keeps the two in step.
export const iconNames = [
  'add', 'alert', 'alignment', 'analytics', 'api-keys', 'archive', 'arrow-left', 'arrow-right',
  'assign-speaker', 'bookmark', 'calendar', 'change-speaker', 'check', 'chevron-down', 'chevron-right', 'clock', 'close',
  'copy', 'delete', 'diarization-model', 'download', 'edit', 'export', 'eye', 'eye-off', 'folder',
  'forward', 'globe', 'highlight', 'info', 'inspector', 'interface', 'microphone', 'microphone-and-system',
  'models', 'more', 'pause', 'pin', 'play', 'play-outline', 'privacy',
  'retry', 'rewind', 'search', 'settings', 'share', 'sidebar-toggle', 'skip-back', 'skip-forward',
  'sparkle', 'speaker-unknown', 'speakers', 'stop', 'success', 'system-audio', 'volume', 'warning', 'waveform', 'whisper-model',
] as const

export type IconName = (typeof iconNames)[number]
