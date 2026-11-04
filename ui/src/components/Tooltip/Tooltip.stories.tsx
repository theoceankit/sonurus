import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Inline } from '../Inline/Inline'
import { Tooltip, TooltipGroup } from './Tooltip'

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

// Hover waits 300 ms, the next one right after shows at once, Tab shows at once.
// Alone, one goes and the next comes.
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

// Neighbours in a row share one tooltip: it stays, its arrow moves to the next
// control and its width follows the text. It stays over the gaps and goes once the
// pointer leaves the row.
export const Group: Story = {
  render: () => (
    <TooltipGroup>
      <Inline gap={2} padding={8} style={{ width: 'fit-content' }}>
        <Tooltip text="Toggle sidebar"><IconButton icon="sidebar-toggle" label="Toggle sidebar" /></Tooltip>
        <Tooltip text="Back"><IconButton icon="arrow-left" label="Back" /></Tooltip>
        <Tooltip text="Forward"><IconButton icon="arrow-right" label="Forward" /></Tooltip>
      </Inline>
    </TooltipGroup>
  ),
}

export const GroupBelow: Story = {
  render: () => (
    <TooltipGroup>
      <Inline gap={1} padding={8} style={{ width: 'fit-content' }}>
        <Tooltip text="Speakers" placement="below"><IconButton icon="speakers" label="Speakers" /></Tooltip>
        <Tooltip text="Settings" placement="below"><IconButton icon="settings" label="Settings" /></Tooltip>
        <Tooltip text="Show inspector" placement="below"><IconButton icon="inspector" label="Show inspector" /></Tooltip>
      </Inline>
    </TooltipGroup>
  ),
}

// A larger control hangs its tooltip higher: the tooltip rises to it and comes down again.
export const GroupOfDifferentSizes: Story = {
  render: () => (
    <TooltipGroup>
      <Inline gap={2} padding={8} style={{ width: 'fit-content' }}>
        <Tooltip text="Rewind 15 seconds"><IconButton icon="rewind" label="Rewind 15 seconds" /></Tooltip>
        <Tooltip text="Play"><IconButton variant="inverse" size="large" icon="play" label="Play" /></Tooltip>
        <Tooltip text="Forward 15 seconds"><IconButton icon="forward" label="Forward 15 seconds" /></Tooltip>
      </Inline>
    </TooltipGroup>
  ),
}

// The first one of a group, as it shows before the pointer moves on.
export const GroupOpen: Story = {
  render: () => (
    <TooltipGroup>
      <Inline gap={2} padding={8} style={{ width: 'fit-content' }}>
        <Tooltip text="Play" open><IconButton icon="play" label="Play" /></Tooltip>
        <Tooltip text="Edit"><IconButton icon="edit" label="Edit" /></Tooltip>
        <Tooltip text="Copy"><IconButton icon="copy" label="Copy" /></Tooltip>
      </Inline>
    </TooltipGroup>
  ),
}
