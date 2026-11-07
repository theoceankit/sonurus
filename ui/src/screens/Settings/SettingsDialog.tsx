import { useEffect, useState, type ComponentType } from 'react'
import { Modal } from '../../components/Modal/Modal'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { NavTab } from '../../components/NavTab/NavTab'
import { ScrollBar } from '../../components/ScrollBar/ScrollBar'
import { TabPanel, Tabs } from '../../components/Tabs/Tabs'
import { AlignmentSection } from './AlignmentSection'
import { GeneralSection } from './GeneralSection'
import { GpuSection } from './GpuSection'
import { ModelsSection } from './ModelsSection'
import { useGpu } from '../../settings/gpu'
import { formatAppVersion, SECTIONS, type SettingsSection } from './sections'
import styles from './SettingsDialog.module.css'

export interface SettingsDialogProps {
  open: boolean
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

const PANELS: Record<SettingsSection, ComponentType> = {
  general: GeneralSection,
  models: ModelsSection,
  alignment: AlignmentSection,
  gpu: GpuSection,
}

// macOS has no GPU acceleration: no section for it, as the old UI hid its card.
function useGpuHidden() {
  const [platform, setPlatform] = useState<string | null>(null)
  const { state } = useGpu()
  useEffect(() => {
    let current = true
    window.electronAPI?.getPlatform().then(read => { if (current) setPlatform(read) }).catch(() => {})
    return () => { current = false }
  }, [])
  return platform === 'darwin' || state.status?.blocked_reason === 'unsupported_platform'
}

function useAppVersion() {
  const [version, setVersion] = useState(() => formatAppVersion(undefined))
  useEffect(() => {
    let current = true
    window.electronAPI?.getAppVersion()
      .then(read => { if (current) setVersion(formatAppVersion(read)) })
      .catch(() => {})
    return () => { current = false }
  }, [])
  return version
}

// Settings apply as they change: there is nothing to save, and the window only closes.
export function SettingsDialog({ open, section, onSectionChange, onClose, preview }: SettingsDialogProps) {
  const version = useAppVersion()
  const gpuHidden = useGpuHidden()
  const [area, setArea] = useState<HTMLElement | null>(null)
  const sections = SECTIONS.filter(entry => entry.id !== 'gpu' || !gpuHidden)
  const current = sections.find(entry => entry.id === section) ?? sections[0]
  const Panel = PANELS[current.id]
  return (
    <Modal size="large" open={open} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Settings" />
      <Tabs
        orientation="vertical"
        aria-label="Settings sections"
        value={current.id}
        onValueChange={value => onSectionChange(value as SettingsSection)}
        className={styles.columns}
        tabs={sections.map(entry => <NavTab key={entry.id} value={entry.id} icon={entry.icon}>{entry.label}</NavTab>)}
        footer={<span className={styles.version}>{version}</span>}
      >
        <div className={styles.content}>
          <TabPanel key={current.id} value={current.id} ref={setArea} className={styles.panel} data-modal-body>
            <h2 className={styles.heading}>{current.label}</h2>
            <Panel />
          </TabPanel>
          <ScrollBar area={area} />
        </div>
      </Tabs>
    </Modal>
  )
}
