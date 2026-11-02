import type { Meta, StoryObj } from '@storybook/react-vite'
import { Inline } from '../Inline/Inline'
import { Stack } from '../Stack/Stack'
import { ScrollFade, useScrollEdges } from './ScrollFade'

const meta: Meta<typeof ScrollFade> = {
  component: ScrollFade,
  args: { edge: 'bottom' },
}
export default meta

type Story = StoryObj<typeof ScrollFade>

type Surface = 'window' | 'raised' | 'sunken'
const BACKGROUND: Record<Surface, string> = {
  window: 'var(--color-bg-window)',
  raised: 'var(--color-bg-raised)',
  sunken: 'var(--color-bg-sunken)',
}

function List({ surface, size }: { surface: Surface; size?: 'md' | 'lg' }) {
  const { scrollRef, top, bottom } = useScrollEdges()
  return (
    <Stack gap={1}>
      <span>{surface}{size === 'lg' ? ', sidebar height' : ''}</span>
      <div style={{ position: 'relative', width: 200, height: 240, background: BACKGROUND[surface] }}>
        <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }}>
          <Stack gap={2} padding={2}>
            {Array.from({ length: 24 }, (_, row) => <span key={row}>Row {row + 1} of the list</span>)}
          </Stack>
        </div>
        {top && <ScrollFade edge="top" surface={surface} size={size} />}
        {bottom && <ScrollFade edge="bottom" surface={surface} size={size} />}
      </div>
    </Stack>
  )
}

// Scroll each list: the fade goes away at the end it has reached. Switch the theme.
export const Surfaces: Story = {
  render: () => (
    <Inline gap={4} align="start" padding={4} style={{ background: 'var(--color-bg-muted)' }}>
      <List surface="window" />
      <List surface="raised" />
      <List surface="sunken" />
      <List surface="sunken" size="lg" />
    </Inline>
  ),
}

// All edges and surfaces at rest, as on the board.
export const Matrix: Story = {
  render: () => (
    <Inline gap={4} padding={4} style={{ background: 'var(--color-bg-muted)' }}>
      {(['window', 'raised', 'sunken'] as const).flatMap(surface => (['bottom', 'top'] as const).map(edge => (
        <div key={surface + edge} style={{ position: 'relative', width: 120, height: 'var(--size-scroll-fade-md)' }}>
          <ScrollFade edge={edge} surface={surface} />
        </div>
      )))}
    </Inline>
  ),
}
