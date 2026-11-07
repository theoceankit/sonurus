import { useEffect, useState } from 'react'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { Inline } from '../../components/Inline/Inline'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { Slider } from '../../components/Slider/Slider'
import { markNotImplemented } from '../../not-implemented'
import { settingsStore, useSettings } from '../../platform/settings'
import { LANGUAGES } from '../../transcribe/languages'
import styles from './Settings.module.css'

export const SCALE = { min: 50, max: 200, step: 5 }
const SCALE_MARKS = [50, 100, 150, 200].map(value => ({ value, label: `${value}%` }))

const INTERFACE_LANGUAGES = LANGUAGES.filter(({ code }) => code !== 'auto').map(({ code, label }) => ({ value: code, label }))

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

// The slider follows the pointer; the zoom and the file change once it lets go.
function InterfaceScale({ saved }: { saved: number }) {
  const [scale, setScale] = useState(saved)
  useEffect(() => setScale(saved), [saved])
  const commit = (value: number) => {
    void bridge()?.setZoom(value / 100).catch(() => {})
    void settingsStore().patch({ scale: value })
  }
  return (
    <FieldRow label="Interface scale" hint="Affects type sizes and spacing." stacked>
      <Inline gap={3} align="start" className={styles.scale}>
        <Slider
          label="Interface scale"
          orientation="horizontal"
          {...SCALE}
          value={scale}
          onChange={setScale}
          onCommit={commit}
          marks={SCALE_MARKS}
          valueText={value => `${value}%`}
        />
        <span className={styles.scaleValue} aria-hidden>{scale}%</span>
      </Inline>
    </FieldRow>
  )
}

// How the app looks. The language and the theme are not there yet: the interface
// has one language, and the theme follows the system.
export function AppearanceSection() {
  const settings = useSettings()
  if (!settings) return null
  return (
    <SectionCard title="Interface">
      <FieldRow label="Theme" hint="Light, dark, or as the system is set.">
        <div className={styles.stretch} {...markNotImplemented('settings.theme')}>
          <Select aria-label="Theme" value="system" options={THEMES} onValueChange={() => {}} />
        </div>
      </FieldRow>
      <FieldRow label="App language" hint="Language used across menus and dialogs.">
        <div className={styles.stretch} {...markNotImplemented('settings.app-language')}>
          <Select aria-label="App language" value="en" options={INTERFACE_LANGUAGES} onValueChange={() => {}} />
        </div>
      </FieldRow>
      <InterfaceScale saved={settings.scale} />
    </SectionCard>
  )
}
