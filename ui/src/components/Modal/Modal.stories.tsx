import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Button } from '../Button/Button'
import { Inline } from '../Inline/Inline'
import { Menu, MenuAction } from '../Menu/Menu'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
import { SearchField } from '../SearchField/SearchField'
import { Stack } from '../Stack/Stack'
import { TextField } from '../TextField/TextField'
import { toast } from '../Toast/toast'
import { Tooltip } from '../Tooltip/Tooltip'
import { Modal, type ModalSize, type ModalType } from './Modal'

const meta: Meta<typeof Modal> = {
  component: Modal,
  args: { children: null },
}
export default meta

type Story = StoryObj<typeof Modal>

const parts = (type: ModalType) => (
  <>
    <ModalHeader title="Modal title" />
    <ModalBody>Modal content</ModalBody>
    <ModalFooter confirm={{ children: type === 'danger' ? 'Delete' : 'Confirm' }} />
  </>
)

// Rows and columns as on the board, drawn in place. The live stories open real ones.
export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={['Default', 'Danger'] as const}
      rows={(['small', 'medium', 'large'] as ModalSize[]).map(size => ({
        label: size,
        render: state => {
          const type = state.toLowerCase() as ModalType
          return <Modal preview size={size} type={type}>{parts(type)}</Modal>
        },
      }))}
    />
  ),
}

function Live({ type, size, label, children }: { type?: ModalType; size?: ModalSize; label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} type={type} size={size}>{children(() => setOpen(false))}</Modal>
    </>
  )
}

function SearchInside() {
  const [query, setQuery] = useState('Zoe')
  return <SearchField aria-label="Search" value={query} onValueChange={setQuery} />
}

function LongList() {
  const { scrollRef, top, bottom } = useScrollEdges()
  return (
    <div style={{ position: 'relative', height: 240 }}>
      <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }}>
        <Stack gap={2}>{Array.from({ length: 30 }, (_, row) => <span key={row}>Row {row + 1}</span>)}</Stack>
      </div>
      {top && <ScrollFade edge="top" surface="raised" />}
      {bottom && <ScrollFade edge="bottom" surface="raised" />}
    </div>
  )
}

// Tab stays inside. Escape, the scrim, Cancel and the close button all close, and
// focus goes back to the button that opened it.
export const Behaviour: Story = {
  render: () => (
    <Inline gap={2} wrap>
      <Live label="Form" size="medium">
        {close => (
          <>
            <ModalHeader title="New speaker" description="Focus starts in the first field" />
            <ModalBody>
              <TextField label="Name" />
              <TextField label="Handle" />
            </ModalBody>
            <ModalFooter leading={<Button variant="ghost" icon="add">Action</Button>} confirm={{ children: 'Create', onClick: close }} />
          </>
        )}
      </Live>
      <Live label="Danger" type="danger">
        {close => (
          <>
            <ModalHeader title="Delete transcript?" icon="alert" />
            <ModalBody>Focus starts on Cancel.</ModalBody>
            <ModalFooter confirm={{ children: 'Delete', onClick: () => { close(); toast({ message: 'Transcript deleted', action: { label: 'Undo', onClick: () => {} } }) } }} />
          </>
        )}
      </Live>
      <Live label="Search inside" size="medium">
        {() => (
          <>
            <ModalHeader title="Choose a speaker" />
            <ModalBody><SearchInside /><span>The first Escape clears the field, the next one closes.</span></ModalBody>
            <ModalFooter />
          </>
        )}
      </Live>
      <Live label="Layers inside" size="medium">
        {() => (
          <>
            <ModalHeader title="Layers" description="A toast stays clickable over the scrim" />
            <ModalBody>
              <Inline gap={2}>
                <Tooltip text="Above the window"><Button>Tooltip</Button></Tooltip>
                <Menu trigger={<Button>Menu</Button>}>
                  <MenuAction>First</MenuAction>
                  <MenuAction>Second</MenuAction>
                </Menu>
                <Button onClick={() => toast({ message: 'Over the scrim', action: { label: 'Undo', onClick: () => {} } })}>Toast</Button>
              </Inline>
            </ModalBody>
            <ModalFooter />
          </>
        )}
      </Live>
      <Live label="Long content" size="large">
        {() => (
          <>
            <ModalHeader title="The body scrolls" />
            <ModalBody>{Array.from({ length: 60 }, (_, row) => <span key={row}>Row {row + 1}</span>)}</ModalBody>
            <ModalFooter confirm={{ children: 'Confirm' }} />
          </>
        )}
      </Live>
      <Live label="List with fades" size="large">
        {() => (
          <>
            <ModalHeader title="Fades on the raised surface" />
            <ModalBody><LongList /></ModalBody>
            <ModalFooter />
          </>
        )}
      </Live>
    </Inline>
  ),
}

export const OpenFromMenu: Story = {
  render: () => {
    function FromMenu() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Menu trigger={<Button>More</Button>}>
            <MenuAction onSelect={() => setOpen(true)}>Delete</MenuAction>
          </Menu>
          <Modal type="danger" open={open} onOpenChange={setOpen}>
            <ModalHeader title="Delete transcript?" />
            <ModalBody>Closing brings focus back to More.</ModalBody>
            <ModalFooter confirm={{ children: 'Delete', onClick: () => setOpen(false) }} />
          </Modal>
        </>
      )
    }
    return <FromMenu />
  },
}
