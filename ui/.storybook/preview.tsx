import type { Preview } from '@storybook/react-vite'
import { useMemo } from 'react'
import { ApiProvider } from '../src/api/ApiProvider'
import { createFixtureClient } from '../src/api/fixtures/fixture-client'
import { createMockElectronAPI } from '../src/platform/electron-api-mock'
import '../src/styles/index.css'

window.electronAPI = createMockElectronAPI()

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, { globals }) => {
      document.documentElement.dataset.theme = globals.theme
      return <Story />
    },
    // Fixtures for every story, one client per story; parameters.api picks the
    // scenario or the board (FixtureOptions).
    (Story, { id, parameters }) => {
      const client = useMemo(() => createFixtureClient(parameters.api), [id, parameters.api])
      return <ApiProvider key={id} client={client}><Story /></ApiProvider>
    },
  ],
}
export default preview
