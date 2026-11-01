import type { Preview } from '@storybook/react-vite'
import '../src/styles/index.css'

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
  ],
}
export default preview
