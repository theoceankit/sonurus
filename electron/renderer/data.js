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
// Used by import-view for the model dropdown. settings-view fetches from
// GET /models at render time and does not use this array.

const MODELS = [
  { id: 'tiny',     name: 'Whisper Tiny',     size: '39 MB',   speed: '~10× realtime', acc: 'Low',                installed: false, recommended: false, kind: 'whisper'      },
  { id: 'base',     name: 'Whisper Base',     size: '74 MB',   speed: '~7× realtime',  acc: 'Fair',               installed: false, recommended: false, kind: 'whisper'      },
  { id: 'small',    name: 'Whisper Small',    size: '244 MB',  speed: '~4× realtime',  acc: 'Good',               installed: false, recommended: false, kind: 'whisper'      },
  { id: 'medium',   name: 'Whisper Medium',   size: '769 MB',  speed: '~2× realtime',  acc: 'Very good',          installed: false, recommended: false, kind: 'whisper'      },
  { id: 'large-v3', name: 'Whisper Large v3', size: '1.55 GB', speed: '~1× realtime',  acc: 'Best',               installed: false, recommended: true,  kind: 'whisper'      },
  { id: 'diarize',  name: 'Diarization · v2', size: '112 MB',  speed: '—',             acc: 'Speaker separation', installed: false, recommended: false, kind: 'diarization'  },
]

// ── Alignment Models ──────────────────────────────────────────────────────────
// wav2vec2-based alignment models for word-level timestamps.
// Languages covered by torchaudio (en, fr, de, es, it) are NOT listed here.

const ALIGNMENT_MODELS = [
  { id: 'ru', kind: 'alignment', lang: 'ru', name: 'Russian',    nativeName: 'Русский',      size: '~1.3 GB' },
  { id: 'zh', kind: 'alignment', lang: 'zh', name: 'Chinese',    nativeName: '中文',          size: '~1.3 GB' },
  { id: 'ja', kind: 'alignment', lang: 'ja', name: 'Japanese',   nativeName: '日本語',        size: '~1.3 GB' },
  { id: 'ko', kind: 'alignment', lang: 'ko', name: 'Korean',     nativeName: '한국어',        size: '~1.3 GB' },
  { id: 'uk', kind: 'alignment', lang: 'uk', name: 'Ukrainian',  nativeName: 'Українська',   size: '~1.3 GB' },
  { id: 'pt', kind: 'alignment', lang: 'pt', name: 'Portuguese', nativeName: 'Português',    size: '~1.3 GB' },
  { id: 'ar', kind: 'alignment', lang: 'ar', name: 'Arabic',     nativeName: 'العربية',      size: '~1.3 GB' },
  { id: 'nl', kind: 'alignment', lang: 'nl', name: 'Dutch',      nativeName: 'Nederlands',   size: '~1.3 GB' },
  { id: 'pl', kind: 'alignment', lang: 'pl', name: 'Polish',     nativeName: 'Polski',       size: '~1.3 GB' },
  { id: 'hi', kind: 'alignment', lang: 'hi', name: 'Hindi',      nativeName: 'हिन्दी',      size: '~1.3 GB' },
  { id: 'cs', kind: 'alignment', lang: 'cs', name: 'Czech',      nativeName: 'Čeština',      size: '~300 MB' },
  { id: 'tr', kind: 'alignment', lang: 'tr', name: 'Turkish',    nativeName: 'Türkçe',       size: '~300 MB' },
  { id: 'hu', kind: 'alignment', lang: 'hu', name: 'Hungarian',  nativeName: 'Magyar',       size: '~1.3 GB' },
  { id: 'fi', kind: 'alignment', lang: 'fi', name: 'Finnish',    nativeName: 'Suomi',        size: '~1.3 GB' },
  { id: 'fa', kind: 'alignment', lang: 'fa', name: 'Persian',    nativeName: 'فارسی',        size: '~1.3 GB' },
  { id: 'el', kind: 'alignment', lang: 'el', name: 'Greek',      nativeName: 'Ελληνικά',     size: '~1.3 GB' },
  { id: 'da', kind: 'alignment', lang: 'da', name: 'Danish',     nativeName: 'Dansk',        size: '~300 MB' },
  { id: 'he', kind: 'alignment', lang: 'he', name: 'Hebrew',     nativeName: 'עברית',        size: '~300 MB' },
  { id: 'vi', kind: 'alignment', lang: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt',   size: '~360 MB' },
  { id: 'ur', kind: 'alignment', lang: 'ur', name: 'Urdu',       nativeName: 'اردو',         size: '~300 MB' },
  { id: 'te', kind: 'alignment', lang: 'te', name: 'Telugu',     nativeName: 'తెలుగు',       size: '~1.3 GB' },
  { id: 'ca', kind: 'alignment', lang: 'ca', name: 'Catalan',    nativeName: 'Català',       size: '~1.3 GB' },
  { id: 'ml', kind: 'alignment', lang: 'ml', name: 'Malayalam',  nativeName: 'മലയാളം',       size: '~1.3 GB' },
  { id: 'no', kind: 'alignment', lang: 'no', name: 'Norwegian',  nativeName: 'Norsk',        size: '~1.3 GB' },
  { id: 'nn', kind: 'alignment', lang: 'nn', name: 'Nynorsk',    nativeName: 'Nynorsk',      size: '~1.3 GB' },
  { id: 'sk', kind: 'alignment', lang: 'sk', name: 'Slovak',     nativeName: 'Slovenčina',   size: '~300 MB' },
  { id: 'sl', kind: 'alignment', lang: 'sl', name: 'Slovenian',  nativeName: 'Slovenščina',  size: '~1.3 GB' },
  { id: 'hr', kind: 'alignment', lang: 'hr', name: 'Croatian',   nativeName: 'Hrvatski',     size: '~1.3 GB' },
  { id: 'ro', kind: 'alignment', lang: 'ro', name: 'Romanian',   nativeName: 'Română',       size: '~1.3 GB' },
  { id: 'eu', kind: 'alignment', lang: 'eu', name: 'Basque',     nativeName: 'Euskara',      size: '~1.3 GB' },
  { id: 'gl', kind: 'alignment', lang: 'gl', name: 'Galician',   nativeName: 'Galego',       size: '~1.3 GB' },
  { id: 'ka', kind: 'alignment', lang: 'ka', name: 'Georgian',   nativeName: 'ქართული',      size: '~1.3 GB' },
  { id: 'lv', kind: 'alignment', lang: 'lv', name: 'Latvian',    nativeName: 'Latviešu',     size: '~1.3 GB' },
  { id: 'tl', kind: 'alignment', lang: 'tl', name: 'Filipino',   nativeName: 'Filipino',     size: '~300 MB' },
  { id: 'sv', kind: 'alignment', lang: 'sv', name: 'Swedish',    nativeName: 'Svenska',      size: '~1.3 GB' },
]
