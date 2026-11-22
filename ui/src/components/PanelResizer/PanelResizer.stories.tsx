import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type CSSProperties } from 'react'
import { PanelResizer } from './PanelResizer'
import styles from './PanelResizer.stories.module.css'

const meta: Meta<typeof PanelResizer> = { component: PanelResizer }
export default meta

type Story = StoryObj<typeof PanelResizer>

function Panels({ initial }: { initial: number }) {
  const [saved, setSaved] = useState(initial)
  const [shown, setShown] = useState(initial)
  return (
    <div className={styles.frame} style={{ '--side-width': `${shown}px` } as CSSProperties}>
      <div className={styles.box}>Centre</div>
      <PanelResizer
        label="Resize panel"
        onResize={travel => setShown(Math.max(initial, saved - travel))}
        onResizeEnd={() => setSaved(shown)}
        onResizeCancel={() => setShown(saved)}
      />
      <div className={`${styles.box} ${styles.side}`}>{shown} px</div>
    </div>
  )
}

// The gap shows nothing but the cursor. Drag it.
export const Default: Story = { render: () => <Panels initial={300} /> }
export const WidePanel: Story = { render: () => <Panels initial={420} /> }
