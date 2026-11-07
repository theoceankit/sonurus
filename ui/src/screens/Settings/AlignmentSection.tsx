import { useModels } from '../../api/queries'
import { ModelRow } from '../../components/ModelRow/ModelRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { ALIGNMENT_MODELS, LANGUAGES } from '../../transcribe/languages'
import { useModelDownloads } from '../../transcribe/model-downloads'
import { Loading, rowState } from './ModelsSection'

// The languages of the list that need no model of their own, from the catalog.
export function alignedWithoutModel(): string[] {
  return LANGUAGES.filter(({ code }) => code !== 'auto' && !ALIGNMENT_MODELS.some(model => model.id === code)).map(({ label }) => label)
}

const list = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

export function AlignmentSection() {
  const models = useModels()
  const downloads = useModelDownloads()
  if (!models.data) return <Loading models={models} />
  const installed = (id: string) => models.data.some(model => model.kind === 'alignment' && model.id === id && model.installed)
  const known = ALIGNMENT_MODELS.filter(model => models.data.some(row => row.kind === 'alignment' && row.id === model.id))
  return (
    <SectionCard
      title="Word timings"
      description="A wav2vec2 model per language places each word in time. Download one for each language you transcribe."
      footer={`Not needed for ${list(alignedWithoutModel())}.`}
    >
      {known.map(model => (
        <ModelRow
          key={model.id}
          icon="alignment"
          name={model.name}
          nativeName={model.nativeName}
          meta={[model.size, 'wav2vec2']}
          {...rowState(installed(model.id), model.id, downloads)}
          onDownload={() => void downloads.start(model.id)}
          onCancel={() => void downloads.cancel(model.id)}
        />
      ))}
    </SectionCard>
  )
}
