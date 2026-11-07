import { useEffect } from 'react'
import { Badge } from '../../components/Badge/Badge'
import { Button } from '../../components/Button/Button'
import { Inline } from '../../components/Inline/Inline'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Stack } from '../../components/Stack/Stack'
import { gpuSectionView, useGpu } from '../../settings/gpu'
import styles from './Settings.module.css'

// GPU acceleration: asks GET /gpu when it opens; a download or a restart it starts
// goes on after Settings close.
export function GpuSection() {
  const { gpu, state } = useGpu()
  useEffect(() => { void gpu.refresh() }, [gpu])
  const { status, ...ui } = state
  const view = gpuSectionView(status, ui)
  if (view.hidden) return <p className={styles.quiet}>{status ? 'GPU acceleration is not available on this system.' : 'Checking the graphics card…'}</p>
  const run = (id: 'download' | 'cancel' | 'remove') => {
    if (id === 'download') gpu.startDownload()
    else if (id === 'cancel') void gpu.cancelDownload()
    else void gpu.remove()
  }
  return (
    <SectionCard
      title="GPU acceleration"
      description="Faster transcription on an NVIDIA graphics card."
      action={<Badge tone={view.tone}>{view.label}</Badge>}
    >
      <Stack gap={2} paddingY={3}>
        <Inline gap={3} wrap className={styles.gpuHead}>
          {status?.gpu && <span className={styles.gpuName}>{status.gpu.name}, driver {status.gpu.driver}</span>}
          <span className={styles.quiet}>Running on {view.device}</span>
        </Inline>
        <p className={styles.gpuDetail}>{view.detail}</p>
        {view.progress && (
          <Inline gap={2}>
            <div role="progressbar" aria-label="GPU download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress.pct)} className={styles.gpuTrack}>
              <div className={styles.gpuFill} style={{ width: `${view.progress.pct}%` }} />
            </div>
            <span className={styles.gpuPct}>{Math.round(view.progress.pct)}%</span>
          </Inline>
        )}
        {view.actions.length > 0 && (
          <Inline gap={2}>
            {view.actions.map(action => (
              <Button key={action.id} size="small" variant={action.primary ? 'primary' : 'secondary'} onClick={() => run(action.id)}>{action.label}</Button>
            ))}
          </Inline>
        )}
      </Stack>
    </SectionCard>
  )
}
