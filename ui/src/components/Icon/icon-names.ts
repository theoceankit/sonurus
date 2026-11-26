// One entry per file in assets/icons; Icon.test.tsx keeps the two in step.
export const iconNames = [
  'add', 'alert', 'alignment', 'analytics', 'anchor', 'api-keys', 'archive', 'arrow-left', 'arrow-right',
  'assign-speaker', 'bold', 'bookmark', 'calendar', 'change-speaker', 'check', 'checkbox', 'chevron-down', 'chevron-right', 'clock', 'close', 'collapse',
  'copy', 'delete', 'diarization-model', 'download', 'edit', 'expand', 'export', 'external-link', 'eye', 'eye-off', 'folder',
  'forward', 'globe', 'highlight', 'home', 'info', 'inspector', 'interface', 'italic', 'lightbulb', 'link', 'list-bullet', 'list-numbered', 'menu', 'microphone', 'microphone-and-system',
  'models', 'moon', 'more', 'notification', 'pause', 'pin', 'play', 'play-outline', 'privacy', 'quote',
  'retry', 'rewind', 'search', 'settings', 'share', 'sidebar-toggle', 'skip-back', 'skip-forward',
  'sparkle', 'speaker-unknown', 'speakers', 'stop', 'success', 'sun', 'system', 'system-audio', 'volume', 'warning', 'waveform', 'whisper-model', 'wrap',
] as const

export type IconName = (typeof iconNames)[number]
