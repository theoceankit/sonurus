import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Inline } from '../Inline/Inline'
import { Tooltip } from './Tooltip'

const meta: Meta<typeof Tooltip> = {
  component: Tooltip,
  args: { text: 'Reassign speaker', children: <Button>Target</Button> },
}
export default meta

type Story = StoryObj<typeof Tooltip>

export const Matrix: Story = {
  render: () => (
    <div style={{ paddingBlock: 'var(--space-8)' }}>
      <StateMatrix
        states={['Above', 'Below', 'None'] as const}
        rows={[{
          label: 'Placement',
          render: placement => (
            <Tooltip text="Reassign speaker" open placement={placement.toLowerCase() as 'above' | 'below' | 'none'}>
              <IconButton icon="speakers" label="Reassign speaker" />
            </Tooltip>
          ),
        }]}
      />
    </div>
  ),
}

// Hover waits 400 ms, the next one right after shows at once, Tab shows at once.
export const Live: Story = {
  render: () => (
    <Inline gap={2} padding={8}>
      <Tooltip text="Reassign speaker"><IconButton icon="speakers" label="Reassign speaker" /></Tooltip>
      <Tooltip text="Copy text"><IconButton icon="copy" label="Copy text" /></Tooltip>
      <Tooltip text="Edit text" placement="below"><IconButton icon="edit" label="Edit text" /></Tooltip>
      <Tooltip text="No arrow" placement="none"><IconButton icon="more" label="No arrow" /></Tooltip>
    </Inline>
  ),
}

// At the top edge there is no room above, so it shows below.
export const NoRoomAbove: Story = {
  render: () => <Tooltip text="Reassign speaker" open><IconButton icon="speakers" label="Reassign speaker" /></Tooltip>,
}
