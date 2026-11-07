import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { FIRST_SECTION, type SettingsSection } from './sections'
import { SettingsDialog } from './SettingsDialog'

type SettingsDialogControl = {
  // Opens Settings on a section, the first one by default; on another section if open.
  open: (section?: SettingsSection) => void
}

// Without a provider (a screen alone in a story or a test) nothing opens.
const SettingsContext = createContext<SettingsDialogControl>({ open: () => {} })

export const useSettingsDialog = () => useContext(SettingsContext)

// The one Settings window of the app, opened from anywhere below it.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<SettingsSection>(FIRST_SECTION)
  const show = useCallback((next: SettingsSection = FIRST_SECTION) => {
    setSection(next)
    setOpen(true)
  }, [])
  const control = useMemo(() => ({ open: show }), [show])
  return (
    <SettingsContext.Provider value={control}>
      {children}
      <SettingsDialog open={open} section={section} onSectionChange={setSection} onClose={() => setOpen(false)} />
    </SettingsContext.Provider>
  )
}
