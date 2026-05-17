// ── Languages ───────────────────────────────────────────────────────────────────
// Single source of truth used by import-view and settings-view.
// Each entry has `code` as the language key; consumers add `value: l.code` when
// passing to makeDropdown.

const LANGUAGES = [
  { code: 'auto', flag: '🌐', label: 'Detect automatically', sub: 'Recommended'  },
  { code: 'en',   flag: '🇺🇸', label: 'English',             sub: 'United States' },
  { code: 'ru',   flag: '🇷🇺', label: 'Русский',             sub: 'Russia'        },
  { code: 'es',   flag: '🇪🇸', label: 'Español',             sub: 'Spain'         },
  { code: 'de',   flag: '🇩🇪', label: 'Deutsch',             sub: 'Germany'       },
  { code: 'fr',   flag: '🇫🇷', label: 'Français',            sub: 'France'        },
  { code: 'uk',   flag: '🇺🇦', label: 'Українська',          sub: 'Ukraine'       },
  { code: 'zh',   flag: '🇨🇳', label: '中文',                 sub: 'Simplified'    },
  { code: 'ja',   flag: '🇯🇵', label: '日本語',               sub: 'Japan'         },
]

// ── Models ──────────────────────────────────────────────────────────────────────
// Full model catalogue. import-view derives a slim dropdown list from this;
// settings-view uses it for the full model management UI.

const MODELS = [
  { id: 'tiny',     name: 'Whisper Tiny',     size: '39 MB',   speed: '~10× realtime', acc: 'Low',                installed: true,  recommended: false, kind: 'whisper'      },
  { id: 'base',     name: 'Whisper Base',     size: '74 MB',   speed: '~7× realtime',  acc: 'Fair',               installed: true,  recommended: false, kind: 'whisper'      },
  { id: 'small',    name: 'Whisper Small',    size: '244 MB',  speed: '~4× realtime',  acc: 'Good',               installed: true,  recommended: false, kind: 'whisper'      },
  { id: 'medium',   name: 'Whisper Medium',   size: '769 MB',  speed: '~2× realtime',  acc: 'Very good',          installed: false, recommended: false, kind: 'whisper'      },
  { id: 'large-v3', name: 'Whisper Large v3', size: '1.55 GB', speed: '~1× realtime',  acc: 'Best',               installed: false, recommended: true,  kind: 'whisper'      },
  { id: 'diarize',  name: 'Diarization · v2', size: '112 MB',  speed: '—',             acc: 'Speaker separation', installed: true,  recommended: false, kind: 'diarization'  },
]
