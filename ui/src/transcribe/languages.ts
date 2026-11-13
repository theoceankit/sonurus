// The languages a transcription can be asked for, and the alignment models some of
// them need. GET /models gives alignment models an id, whether they are installed
// and their size, so their names are kept here.

export type Language = { code: string; label: string; sub: string }

// "auto" is detected from the audio; the API takes it as null.
export const LANGUAGES: readonly Language[] = [
  { code: 'auto', label: 'Detect automatically', sub: 'Recommended' },
  { code: 'en', label: 'English', sub: 'United States' },
  { code: 'ru', label: 'Русский', sub: 'Russia' },
  { code: 'es', label: 'Español', sub: 'Spain' },
  { code: 'de', label: 'Deutsch', sub: 'Germany' },
  { code: 'fr', label: 'Français', sub: 'France' },
  { code: 'uk', label: 'Українська', sub: 'Ukraine' },
  { code: 'zh', label: '中文', sub: 'Simplified' },
  { code: 'ja', label: '日本語', sub: 'Japan' },
]

export const AUTO_LANGUAGE = 'auto'

// The name of a language for the user, or its code when it is not in the list.
export function languageName(code: string): string {
  return LANGUAGES.find(language => language.code === code)?.label ?? code
}

// The language as the API takes it.
export const apiLanguage = (code: string): string | null => (code === AUTO_LANGUAGE ? null : code)

export type AlignmentModel = { id: string; name: string; nativeName: string }

// Languages that torchaudio aligns by itself (en, fr, de, es, it) are not here.
// The ids are the backend's ALIGNMENT_CATALOG; a test keeps them the same.
export const ALIGNMENT_MODELS: readonly AlignmentModel[] = [
  { id: 'ru', name: 'Russian', nativeName: 'Русский' },
  { id: 'zh', name: 'Chinese', nativeName: '中文' },
  { id: 'ja', name: 'Japanese', nativeName: '日本語' },
  { id: 'ko', name: 'Korean', nativeName: '한국어' },
  { id: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { id: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { id: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { id: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { id: 'pl', name: 'Polish', nativeName: 'Polski' },
  { id: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { id: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { id: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { id: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { id: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { id: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { id: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { id: 'da', name: 'Danish', nativeName: 'Dansk' },
  { id: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { id: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { id: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { id: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { id: 'ca', name: 'Catalan', nativeName: 'Català' },
  { id: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { id: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { id: 'nn', name: 'Nynorsk', nativeName: 'Nynorsk' },
  { id: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { id: 'sl', name: 'Slovenian', nativeName: 'Slovenščina' },
  { id: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { id: 'ro', name: 'Romanian', nativeName: 'Română' },
  { id: 'eu', name: 'Basque', nativeName: 'Euskara' },
  { id: 'gl', name: 'Galician', nativeName: 'Galego' },
  { id: 'ka', name: 'Georgian', nativeName: 'ქართული' },
  { id: 'lv', name: 'Latvian', nativeName: 'Latviešu' },
  { id: 'tl', name: 'Filipino', nativeName: 'Filipino' },
  { id: 'sv', name: 'Swedish', nativeName: 'Svenska' },
]

export function alignmentModel(language: string): AlignmentModel {
  return ALIGNMENT_MODELS.find(model => model.id === language) ?? { id: language, name: language, nativeName: '' }
}
