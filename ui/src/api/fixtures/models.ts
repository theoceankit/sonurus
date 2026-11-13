import type { components } from '../schema.gen'
import type { ModelInfo } from '../types'
import { ALIGNMENT_MODELS } from '../../transcribe/languages'

// GET /models as the backend answers it: Whisper models least to most accurate,
// the diarization model, then the alignment models with their sizes.
// The alignment models whose size is not the usual one, as in the backend catalog.
const ALIGNMENT_SIZES: Record<string, string> = { vi: '~385 MB', no: '~3.9 GB', nn: '~3.9 GB' }

type Row = Omit<components['schemas']['TranscriptionModelInfo'], 'installed'> | Omit<components['schemas']['AlignmentModelInfo'], 'installed'>

const CATALOG: readonly Row[] = [
  { id: 'tiny', kind: 'whisper', name: 'Whisper Tiny', size: '39 MB', speed: '~10× realtime', acc: 'Low', recommended: false },
  { id: 'base', kind: 'whisper', name: 'Whisper Base', size: '74 MB', speed: '~7× realtime', acc: 'Fair', recommended: false },
  { id: 'small', kind: 'whisper', name: 'Whisper Small', size: '244 MB', speed: '~4× realtime', acc: 'Good', recommended: false },
  { id: 'medium', kind: 'whisper', name: 'Whisper Medium', size: '769 MB', speed: '~2× realtime', acc: 'Very good', recommended: false },
  { id: 'large-v3', kind: 'whisper', name: 'Whisper Large v3', size: '1.55 GB', speed: '~1× realtime', acc: 'Best', recommended: true },
  { id: 'diarize', kind: 'diarization', name: 'Pyannote Community 1', size: '130 MB', speed: '', acc: 'Speaker separation', recommended: false },
  ...ALIGNMENT_MODELS.map(({ id }) => ({ id, kind: 'alignment' as const, size: ALIGNMENT_SIZES[id] ?? '~1.3 GB' })),
]

// What a fixture client has downloaded unless told otherwise: enough to transcribe
// in any language that needs no alignment model.
export const DEFAULT_INSTALLED: readonly string[] = ['small', 'large-v3', 'diarize']

export function fixtureModels(installed: readonly string[] = DEFAULT_INSTALLED): ModelInfo[] {
  return CATALOG.map(model => ({ ...model, installed: installed.includes(model.id) }) as ModelInfo)
}
