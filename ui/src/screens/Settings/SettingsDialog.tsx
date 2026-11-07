import { useEffect, useState, type ComponentType } from 'react'
import { Modal } from '../../components/Modal/Modal'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { NavTab } from '../../components/NavTab/NavTab'
import { ScrollBar } from '../../components/ScrollBar/ScrollBar'
import { TabPanel, Tabs } from '../../components/Tabs/Tabs'
import { GeneralSection } from './GeneralSection'
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
  const [area, setArea] = useState<HTMLElement | null>(null)
  const Panel = PANELS[section]
  const current = SECTIONS.find(entry => entry.id === section)!
  return (
    <Modal size="large" open={open} preview={preview} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Settings" />
      <Tabs
        orientation="vertical"
        aria-label="Settings sections"
        value={section}
        onValueChange={value => onSectionChange(value as SettingsSection)}
        className={styles.columns}
        tabs={SECTIONS.map(entry => <NavTab key={entry.id} value={entry.id} icon={entry.icon}>{entry.label}</NavTab>)}
        footer={<span className={styles.version}>{version}</span>}
      >
        <div className={styles.content}>
          <TabPanel key={section} value={section} ref={setArea} className={styles.panel} data-modal-body>
            <h2 className={styles.heading}>{current.label}</h2>
            <Panel />
          </TabPanel>
          <ScrollBar area={area} />
        </div>
      </Tabs>
    </Modal>
  )
}
