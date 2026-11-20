import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextSelectionBar } from './TextSelectionBar'

const meta: Meta<typeof TextSelectionBar> = {
  component: TextSelectionBar,
  args: { onCopy: () => {} },
}
export default meta

type Story = StoryObj<typeof TextSelectionBar>

// As in the app today.
export const CopyOnly: Story = {}
// With the note: the quote goes to the cursor in it.
export const WithQuote: Story = { args: { onQuote: () => {} } }
