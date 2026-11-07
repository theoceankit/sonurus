import { Button } from '../../components/Button/Button'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { Stack } from '../../components/Stack/Stack'
import { alignmentModel } from '../../transcribe/languages'
import { retryLabel, type AlignmentState } from './alignment'
import styles from './AlignmentDialog.module.css'

export interface AlignmentDialogProps {
  open: boolean
  language: string
  state: AlignmentState
  // While downloading, from 0 to 100.
  pct: number
  // Failed jobs that one button retries once the model is there.
  retryCount: number
  cancelling: boolean
  onDownload: () => void
  onCancel: () => void
  onRetry: () => void
  onClose: () => void
  // Closes the dialog for Settings, where the model can be downloaded too.
  onOpenSettings?: () => void
  onExited?: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

const TITLES: Record<AlignmentState, (name: string) => string> = {
  offer: () => 'Alignment model required',
  downloading: name => `Downloading ${name} alignment model…`,
  ready: () => 'Download complete',
  failed: () => 'Download failed',
}

// A job failed because the alignment model of its language is not downloaded: the
// model can be downloaded here, and the jobs retried, without going to Settings.
export function AlignmentDialog({
  open, language, state, pct, retryCount, cancelling, onDownload, onCancel, onRetry, onClose, onOpenSettings, onExited, preview,
}: AlignmentDialogProps) {
  const model = alignmentModel(language)
  const download = { children: model.size ? `Download ${model.size}` : 'Download', icon: 'download' as const, onClick: onDownload }
  const footer = {
    offer: <ModalFooter cancel={{ children: 'Dismiss' }} confirm={download} />,
    downloading: <ModalFooter cancel={{ children: cancelling ? 'Cancelling…' : 'Cancel', disabled: cancelling, onClick: onCancel }} />,
    ready: <ModalFooter cancel={{ children: 'Close' }} confirm={retryCount > 0 ? { children: retryLabel(retryCount), icon: 'retry', onClick: onRetry } : undefined} />,
    failed: <ModalFooter cancel={{ children: 'Dismiss' }} confirm={{ children: 'Try again', icon: 'retry', onClick: onDownload }} />,
  }[state]

  return (
    <Modal open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader icon="alignment" title={TITLES[state](model.name)} />
      <ModalBody>
        {state === 'offer' && (
          <Stack gap={2} className={styles.text}>
            <span>
              <strong>{model.name}</strong>
              {model.nativeName && <span className={styles.secondary}> ({model.nativeName})</span>}
            </span>
            <span>Download it to get word-level timestamps for this language.</span>
          </Stack>
        )}
        {state === 'downloading' && (
          <Stack gap={2} className={styles.text}>
            <span>This may take a few minutes.</span>
            <div role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className={styles.track}>
              <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.secondary}>{Math.round(pct)}%</span>
          </Stack>
        )}
        {state === 'ready' && (
          <span className={styles.text}>{model.name} alignment model is ready.</span>
        )}
        {state === 'failed' && (
          <Stack gap={2} align="start" className={styles.text}>
            <span>The download did not finish. Try again, or download the model in Settings.</span>
            <Button variant="ghost" size="small" icon="settings" onClick={onOpenSettings}>Open Settings</Button>
          </Stack>
        )}
      </ModalBody>
      {footer}
    </Modal>
  )
}
