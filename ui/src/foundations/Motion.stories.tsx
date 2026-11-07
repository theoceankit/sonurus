import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../components/Button/Button'
import { Collapse } from '../components/Collapse/Collapse'
import { Disclosure } from '../components/Disclosure/Disclosure'
import { IconButton } from '../components/IconButton/IconButton'
import { Inline } from '../components/Inline/Inline'
import { Menu, MenuAction } from '../components/Menu/Menu'
import { Modal } from '../components/Modal/Modal'
import { ModalBody } from '../components/ModalBody/ModalBody'
import { ModalFooter } from '../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../components/ModalHeader/ModalHeader'
import { Stack } from '../components/Stack/Stack'
import { toast } from '../components/Toast/toast-store'
import { Tooltip, TooltipGroup } from '../components/Tooltip/Tooltip'
import { parseTokens } from '../styles/tokens'
import css from '../styles/tokens.css?raw'
import styles from './foundations.module.css'

const meta: Meta = { title: 'Foundations/Motion' }
export default meta

type Story = StoryObj

const MOTION = /^--(duration|delay|ease|motion)-/

export const Tokens: Story = {
  render: () => (
    <Stack gap={1} padding={4}>
      {parseTokens(css).scale.filter(token => MOTION.test(token.name)).map(token => (
        <div key={token.name} className={styles.row}>
          <span className={styles.name}>{token.name}</span>
          <span className={styles.name}>{token.value}</span>
        </div>
      ))}
    </Stack>
  ),
}

function Everything() {
  const [modal, setModal] = useState(false)
  const [more, setMore] = useState(false)
  return (
    <Stack gap={6} padding={4}>
      <Stack gap={2}>
        <span className={styles.heading}>Hover and press</span>
        <Inline gap={2}>
          <Button variant="secondary">Button</Button>
          <Button variant="ghost">Ghost</Button>
          <IconButton icon="more" label="More" />
        </Inline>
      </Stack>
      <Stack gap={2}>
        <span className={styles.heading}>Tooltip: the next one within 300 ms comes at once</span>
        <Inline gap={2}>
          <Tooltip text="Play"><IconButton icon="play" label="Play" /></Tooltip>
          <Tooltip text="Edit"><IconButton icon="edit" label="Edit" /></Tooltip>
          <Tooltip text="Copy" placement="below"><IconButton icon="copy" label="Copy" /></Tooltip>
        </Inline>
      </Stack>
      <Stack gap={2}>
        <span className={styles.heading}>Tooltips of neighbours: one tooltip, its arrow moves to the next</span>
        <TooltipGroup>
          <Inline gap={2} style={{ width: 'fit-content' }}>
            <Tooltip text="Play"><IconButton icon="play" label="Play" /></Tooltip>
            <Tooltip text="Edit"><IconButton icon="edit" label="Edit" /></Tooltip>
            <Tooltip text="Copy"><IconButton icon="copy" label="Copy" /></Tooltip>
          </Inline>
        </TooltipGroup>
      </Stack>
      <Stack gap={2}>
        <span className={styles.heading}>Menu</span>
        <Inline gap={2}>
          <Menu trigger={<Button variant="secondary">Open</Button>}>
            <MenuAction icon="edit">Rename</MenuAction>
            <MenuAction icon="copy">Copy</MenuAction>
          </Menu>
        </Inline>
      </Stack>
      <Stack gap={2}>
        <span className={styles.heading}>Modal and toast</span>
        <Inline gap={2}>
          <Button variant="secondary" onClick={() => setModal(true)}>Open a modal</Button>
          <Button variant="secondary" onClick={() => toast({ message: 'Not available yet' })}>Show a toast</Button>
        </Inline>
        <Modal open={modal} onOpenChange={setModal}>
          <ModalHeader title="Name this speaker" />
          <ModalBody>Close it while it is still opening: it turns back from where it is.</ModalBody>
          <ModalFooter confirm={{ children: 'Save', onClick: () => setModal(false) }} />
        </Modal>
      </Stack>
      <Stack gap={2}>
        <span className={styles.heading}>What opens in place</span>
        <Disclosure label="Optional details">Handle goes here.</Disclosure>
        <Button variant="ghost" size="small" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show 3 more'}</Button>
        <Collapse open={more}><Stack gap={1}><span>Oliver Grant</span><span>Sofia Ramos</span><span>Lena Klein</span></Stack></Collapse>
      </Stack>
    </Stack>
  )
}

// The panels are on Screens/Editor, the bubble on Components/Playhead and the bar of a
// segment on Components/Paragraph.
export const InUse: Story = { render: () => <Everything /> }
