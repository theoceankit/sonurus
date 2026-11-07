import type { Decorator } from '@storybook/react-vite'
import { useMemo } from 'react'
import type { ElectronSettings } from '../../platform/electron-api'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import { DEFAULT_SETTINGS } from '../../platform/settings'

// A bridge of its own for the story, with these settings saved: the settings store
// keeps one per bridge, so stories do not see each other's changes.
export const withSettings = (saved: Partial<ElectronSettings> = {}): Decorator => (Story, { id }) => {
  useMemo(() => {
    const bridge = createMockElectronAPI()
    void bridge.writeSettings({ ...DEFAULT_SETTINGS, ...saved })
    window.electronAPI = bridge
  }, [id])
  return <Story />
}
