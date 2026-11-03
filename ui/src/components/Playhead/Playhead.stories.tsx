import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { Playhead } from './Playhead'
import styles from './Playhead.stories.module.css'

const meta: Meta<typeof Playhead> = {
  component: Playhead,
  args: { position: 0.5 },
  decorators: [Story => <div className={styles.track}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Playhead>

export const Default: Story = {}

export const Hover: Story = { args: { look: 'hover', time: '00:35' } }

export const HoverWithName: Story = { args: { look: 'hover', time: '00:35', name: 'Anna Petrova' } }

export const LongName: Story = {
  args: { look: 'hover', time: '1:02:05', name: 'Alexandrina Montgomery-Featherstonehaugh the Third' },
}

const CHANGES = [['59:58', 'Anna'], ['59:59', 'Anna'], ['1:00:00', 'Anna'], ['1:00:01', 'Unknown speaker 1'], ['1:00:02', 'Mark'], ['1:00:03', undefined]] as const

function Changing() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const next = setInterval(() => setIndex(value => (value + 1) % CHANGES.length), 900)
    return () => clearInterval(next)
  }, [])
  const [time, name] = CHANGES[index]
  return <Playhead look="hover" position={0.5} time={time} name={name} />
}

// The width moves with another speaker, or when the hour comes in.
export const WidthChanging: Story = { render: () => <Changing /> }

