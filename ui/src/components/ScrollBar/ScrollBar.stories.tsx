import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ScrollBar } from './ScrollBar'
import styles from './ScrollBar.stories.module.css'

const meta: Meta = { title: 'Components/ScrollBar' }
export default meta

type Story = StoryObj

const TEXT = 'We went through the release plan and agreed to move the export work to the next cycle, because the review of speakers needs one more round with real recordings. '

function Area({ repeat }: { repeat: number }) {
  const [area, setArea] = useState<HTMLElement | null>(null)
  return (
    <div className={styles.frame}>
      <div ref={setArea} className={styles.area} tabIndex={0}>{TEXT.repeat(repeat)}</div>
      <ScrollBar area={area} />
    </div>
  )
}

// Bring the pointer over the area: the bar shows. Scroll or drag the thumb.
export const Long: Story = { render: () => <Area repeat={12} /> }

// Very long, so the thumb stays at its smallest.
export const VeryLong: Story = { render: () => <Area repeat={400} /> }

// Everything fits, so there is no bar.
export const Fits: Story = { render: () => <Area repeat={1} /> }
