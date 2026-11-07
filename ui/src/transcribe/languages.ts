// The languages a transcription can be asked for, and the alignment models some of
// them need. GET /models gives alignment models only an id and whether they are
// installed, so their names and sizes are kept here, as in the old UI's data.js.

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

export type AlignmentModel = { id: string; name: string; nativeName: string; size: string }

// Languages that torchaudio aligns by itself (en, fr, de, es, it) are not here.
// The ids are the backend's ALIGNMENT_CATALOG; a test keeps them the same.
export const ALIGNMENT_MODELS: readonly AlignmentModel[] = [
  { id: 'ru', name: 'Russian', nativeName: 'Русский', size: '~1.3 GB' },
  { id: 'zh', name: 'Chinese', nativeName: '中文', size: '~1.3 GB' },
  { id: 'ja', name: 'Japanese', nativeName: '日本語', size: '~1.3 GB' },
  { id: 'ko', name: 'Korean', nativeName: '한국어', size: '~1.3 GB' },
  { id: 'uk', name: 'Ukrainian', nativeName: 'Українська', size: '~1.3 GB' },
  { id: 'pt', name: 'Portuguese', nativeName: 'Português', size: '~1.3 GB' },
  { id: 'ar', name: 'Arabic', nativeName: 'العربية', size: '~1.3 GB' },
  { id: 'nl', name: 'Dutch', nativeName: 'Nederlands', size: '~1.3 GB' },
  { id: 'pl', name: 'Polish', nativeName: 'Polski', size: '~1.3 GB' },
  { id: 'hi', name: 'Hindi', nativeName: 'हिन्दी', size: '~1.3 GB' },
  { id: 'cs', name: 'Czech', nativeName: 'Čeština', size: '~300 MB' },
  { id: 'tr', name: 'Turkish', nativeName: 'Türkçe', size: '~300 MB' },
  { id: 'hu', name: 'Hungarian', nativeName: 'Magyar', size: '~1.3 GB' },
  { id: 'fi', name: 'Finnish', nativeName: 'Suomi', size: '~1.3 GB' },
  { id: 'fa', name: 'Persian', nativeName: 'فارسی', size: '~1.3 GB' },
  { id: 'el', name: 'Greek', nativeName: 'Ελληνικά', size: '~1.3 GB' },
  { id: 'da', name: 'Danish', nativeName: 'Dansk', size: '~300 MB' },
  { id: 'he', name: 'Hebrew', nativeName: 'עברית', size: '~300 MB' },
  { id: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', size: '~360 MB' },
  { id: 'ur', name: 'Urdu', nativeName: 'اردو', size: '~300 MB' },
  { id: 'te', name: 'Telugu', nativeName: 'తెలుగు', size: '~1.3 GB' },
  { id: 'ca', name: 'Catalan', nativeName: 'Català', size: '~1.3 GB' },
  { id: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', size: '~1.3 GB' },
  { id: 'no', name: 'Norwegian', nativeName: 'Norsk', size: '~1.3 GB' },
  { id: 'nn', name: 'Nynorsk', nativeName: 'Nynorsk', size: '~1.3 GB' },
  { id: 'sk', name: 'Slovak', nativeName: 'Slovenčina', size: '~300 MB' },
  { id: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', size: '~1.3 GB' },
  { id: 'hr', name: 'Croatian', nativeName: 'Hrvatski', size: '~1.3 GB' },
  { id: 'ro', name: 'Romanian', nativeName: 'Română', size: '~1.3 GB' },
  { id: 'eu', name: 'Basque', nativeName: 'Euskara', size: '~1.3 GB' },
  { id: 'gl', name: 'Galician', nativeName: 'Galego', size: '~1.3 GB' },
  { id: 'ka', name: 'Georgian', nativeName: 'ქართული', size: '~1.3 GB' },
  { id: 'lv', name: 'Latvian', nativeName: 'Latviešu', size: '~1.3 GB' },
  { id: 'tl', name: 'Filipino', nativeName: 'Filipino', size: '~300 MB' },
  { id: 'sv', name: 'Swedish', nativeName: 'Svenska', size: '~1.3 GB' },
]

export function alignmentModel(language: string): AlignmentModel {
  return ALIGNMENT_MODELS.find(model => model.id === language) ?? { id: language, name: language, nativeName: '', size: '' }
}
