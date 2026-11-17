import { useModels } from '../../api/queries'
import { ModelRow } from '../../components/ModelRow/ModelRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { ALIGNMENT_MODELS } from '../../transcribe/languages'
import { useLingering } from '../../presence'
import { ConfirmDialog } from './ConfirmDialog'
import { useModelDelete } from './model-delete-action'
import { useModelDownloads } from '../../transcribe/model-downloads'
import { Loading, ModelsFolderLine, rowState } from './ModelsSection'

export function AlignmentSection() {
  const models = useModels()
  const downloads = useModelDownloads()
  const deletion = useModelDelete()
  const confirmation = useLingering(deletion.toConfirm)
  if (!models.data) return <Loading models={models} />
  const installed = (id: string) => models.data.some(model => model.kind === 'alignment' && model.id === id && model.installed)
  const catalogRow = (id: string) => models.data.find(row => row.kind === 'alignment' && row.id === id)!
  const known = ALIGNMENT_MODELS.filter(model => models.data.some(row => row.kind === 'alignment' && row.id === model.id))
  return (
    <SectionCard
      title="Word timings"
      description={<>Download a model for each language you transcribe.<ModelsFolderLine /></>}
    >
      {known.map(model => (
        <ModelRow
          key={model.id}
          icon="alignment"
          name={model.name}
          meta={[catalogRow(model.id).size]}
          {...rowState(installed(model.id), model.id, downloads)}
          onDownload={() => void downloads.start(model.id)}
          onCancel={() => void downloads.cancel(model.id)}
          onDelete={() => deletion.request(catalogRow(model.id), model.name)}
          deleteBlocked={deletion.blocked(catalogRow(model.id))}
        />
      ))}
      {confirmation.value && (
        <ConfirmDialog
          key={confirmation.key}
          prompt={confirmation.value.prompt}
          open={confirmation.open}
          onConfirm={deletion.confirm}
          onClose={deletion.close}
          onExited={confirmation.exited}
        />
      )}
    </SectionCard>
  )
}
