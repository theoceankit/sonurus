import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notImplementedProps } from '../../not-implemented'
import { OverlayProvider } from '../../OverlayProvider'
import { Button } from '../Button/Button'
import { Menu, MenuAction } from '../Menu/Menu'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter, type ModalAction } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { SearchField } from '../SearchField/SearchField'
import { TextField } from '../TextField/TextField'
import { dismissAllToasts, toast } from '../Toast/toast-store'
import { Tooltip } from '../Tooltip/Tooltip'
import { Modal, type ModalType } from './Modal'
import css from './Modal.module.css?raw'

afterEach(() => act(() => dismissAllToasts()))

function Example({ type, children, cancel, onConfirm }: { type?: ModalType; children?: ReactNode; cancel?: ModalAction | null; onConfirm?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <OverlayProvider>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Button>Behind</Button>
      <Modal type={type} open={open} onOpenChange={setOpen}>
        <ModalHeader title="Title" />
        <ModalBody>{children ?? 'Text'}</ModalBody>
        <ModalFooter cancel={cancel} confirm={{ children: 'Confirm', onClick: onConfirm }} />
      </Modal>
    </OverlayProvider>
  )
}

const button = (name: string) => screen.getByRole('button', { name })
const opened = async () => {
  await userEvent.click(button('Open'))
}
const dialog = () => screen.queryByRole('dialog')

test('the window is named by its title and described only if it has a description', async () => {
  const error = vi.spyOn(console, 'error')
  const warn = vi.spyOn(console, 'warn')
  const { rerender } = render(<Modal defaultOpen><ModalHeader title="Title" /></Modal>)
  expect(screen.getByRole('dialog', { name: 'Title' }).hasAttribute('aria-describedby')).toBe(false)
  rerender(<Modal defaultOpen><ModalHeader title="Title" description="More" /></Modal>)
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe(screen.getByText('More').id))
  expect(error).not.toHaveBeenCalled()
  expect(warn).not.toHaveBeenCalled()
})

test('Escape closes and focus goes back to what opened it', async () => {
  render(<Example />)
  await opened()
  await userEvent.keyboard('{Escape}')
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(button('Open'))
})

test.each(['Cancel', 'Close'])('%s closes and focus goes back', async name => {
  render(<Example />)
  await opened()
  await userEvent.click(button(name))
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(button('Open'))
})

test('a click on the scrim closes', async () => {
  render(<Example />)
  await opened()
  const scrim = document.querySelector('[class*="scrim"]')!
  await userEvent.click(scrim)
  expect(dialog()).toBeNull()
})

test('Tab stays inside the window', async () => {
  render(<Example />)
  await opened()
  const window = screen.getByRole('dialog')
  for (let press = 0; press < 6; press++) {
    await userEvent.tab()
    expect(window.contains(document.activeElement)).toBe(true)
  }
  await userEvent.tab({ shift: true })
  expect(window.contains(document.activeElement)).toBe(true)
})

test('the rest of the page is hidden from assistive technology and takes no pointer', async () => {
  render(<Example />)
  await opened()
  expect(document.body.style.pointerEvents).toBe('none')
  expect(screen.queryByRole('button', { name: 'Behind' })).toBeNull()
})

test('a text-only window starts on the first button of the footer, not on the close button', async () => {
  render(<Example />)
  await opened()
  expect(document.activeElement).toBe(button('Cancel'))
})

test('a form starts on its first field', async () => {
  render(<Example><TextField label="Name" /></Example>)
  await opened()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
})

test('danger is an alert dialog, starts on Cancel and has a red confirm', async () => {
  render(<Example type="danger"><TextField label="Name" /></Example>)
  await opened()
  expect(screen.getByRole('alertdialog', { name: 'Title' })).toBeTruthy()
  expect(document.activeElement).toBe(button('Cancel'))
  expect(button('Confirm').className).toContain('danger')
})

test('danger closes on Escape and on the scrim as well', async () => {
  render(<Example type="danger" />)
  await opened()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await opened()
  await userEvent.click(document.querySelector('[class*="scrim"]')!)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('default has a primary confirm that does what it is given', async () => {
  const onConfirm = vi.fn()
  render(<Example onConfirm={onConfirm} />)
  await opened()
  expect(button('Confirm').className).toContain('primary')
  await userEvent.click(button('Confirm'))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  expect(dialog()).not.toBeNull()
})

test('Back in place of Cancel does not close by itself', async () => {
  const onBack = vi.fn()
  render(<Example cancel={{ children: 'Back', icon: 'arrow-left', onClick: onBack }} />)
  await opened()
  await userEvent.click(button('Back'))
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(dialog()).not.toBeNull()
})

test('cancel can be left out, and leading stands at the left', async () => {
  render(
    <Modal defaultOpen>
      <ModalHeader title="Title" />
      <ModalFooter cancel={null} leading={<Button variant="ghost">New speaker</Button>} confirm={{ children: 'Confirm' }} />
    </Modal>,
  )
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  const footer = button('Confirm').parentElement!
  expect(footer.firstElementChild).toBe(button('New speaker'))
})

test('the size sets the window width', () => {
  render(<Modal defaultOpen size="large"><ModalHeader title="Title" /></Modal>)
  expect(screen.getByRole('dialog').className).toContain('large')
  expect(css).toMatch(/\.small \{\s*width: var\(--size-modal-small\)/)
  expect(css).toMatch(/\.medium \{\s*width: var\(--size-modal-medium\)/)
  expect(css).toMatch(/\.large \{\s*width: var\(--size-modal-large\)/)
})

function WithSearch() {
  const [query, setQuery] = useState('Zoe')
  return <SearchField aria-label="Search" value={query} onValueChange={setQuery} />
}

test('the first Escape in a filled search field clears it, the next one closes', async () => {
  render(<Example><WithSearch /></Example>)
  await opened()
  const field = screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement
  field.focus()
  await userEvent.keyboard('{Escape}')
  expect(field.value).toBe('')
  expect(dialog()).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  expect(dialog()).toBeNull()
})

test('a toast shown over the window can be clicked and does not close it', async () => {
  const undo = vi.fn()
  render(<Example><Button onClick={() => toast({ message: 'Deleted', action: { label: 'Undo', onClick: undo } })}>Show</Button></Example>)
  await opened()
  await userEvent.click(button('Show'))
  await userEvent.click(screen.getByRole('button', { name: 'Undo', hidden: true }))
  expect(undo).toHaveBeenCalledTimes(1)
  expect(dialog()).not.toBeNull()
})

test('a toast from before the window opened can be clicked too', async () => {
  const undo = vi.fn()
  render(<Example />)
  act(() => { toast({ message: 'Deleted', action: { label: 'Undo', onClick: undo } }) })
  await opened()
  await userEvent.click(screen.getByRole('button', { name: 'Undo', hidden: true }))
  expect(undo).toHaveBeenCalledTimes(1)
  expect(dialog()).not.toBeNull()
})

test('a marked control inside shows the toast and leaves the window open', async () => {
  const onClick = vi.fn()
  render(<Example><Button {...notImplementedProps('recording.diarize')} onClick={onClick}>Diarize</Button></Example>)
  await opened()
  await userEvent.click(button('Diarize'))
  expect(onClick).not.toHaveBeenCalled()
  expect(dialog()).not.toBeNull()
  expect(screen.getAllByText('Not available yet', { ignore: false }).length).toBeGreaterThan(0)
})

test('a menu inside: arrows work, Escape closes only the menu and focus returns inside', async () => {
  render(
    <Example>
      <Menu trigger={<Button>More</Button>}>
        <MenuAction>First</MenuAction>
        <MenuAction>Second</MenuAction>
      </Menu>
    </Example>,
  )
  await opened()
  await userEvent.click(button('More'))
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(dialog()).not.toBeNull()
  expect(document.activeElement).toBe(button('More'))
})

test('a tooltip inside shows on focus', async () => {
  render(<Example><Tooltip text="Hint"><Button>Target</Button></Tooltip></Example>)
  await opened()
  expect(document.activeElement).toBe(button('Target'))
  expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('Hint')
})

function FromMenu() {
  const [open, setOpen] = useState(false)
  return (
    <OverlayProvider>
      <Menu trigger={<Button>More</Button>}>
        <MenuAction onSelect={() => setOpen(true)}>Delete</MenuAction>
      </Menu>
      <Modal type="danger" open={open} onOpenChange={setOpen}>
        <ModalHeader title="Title" />
        <ModalFooter />
      </Modal>
    </OverlayProvider>
  )
}

test('a window opened from a menu keeps focus inside and returns it to the menu button', async () => {
  render(<FromMenu />)
  await userEvent.click(button('More'))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  await waitFor(() => expect(document.activeElement).toBe(button('Cancel')))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(button('More')))
  expect(document.body.style.pointerEvents).not.toBe('none')
})

test('a preview draws in place without a scrim and takes no focus', () => {
  render(<Modal preview><ModalHeader title="Title" /></Modal>)
  expect(document.querySelector('[class*="scrim"]')).toBeNull()
  expect(screen.getByRole('dialog').className).toContain('preview')
  expect(document.activeElement).toBe(document.body)
})

test('the scrim and the window sit on the modal layer', () => {
  expect(css).toMatch(/\.scrim \{[^}]*z-index: var\(--z-modal\)/)
  expect(css).toMatch(/\.modal \{[^}]*z-index: var\(--z-modal\)/)
})

test('says when the way out has played', async () => {
  const onExited = vi.fn()
  const { rerender } = render(<Modal open onExited={onExited}><ModalHeader title="Rename" /></Modal>)
  expect(onExited).not.toHaveBeenCalled()
  rerender(<Modal open={false} onExited={onExited}><ModalHeader title="Rename" /></Modal>)
  await waitFor(() => expect(onExited).toHaveBeenCalledOnce())
})

test('a window taking over from another has no way in, and still a way out', () => {
  render(<Modal open skipEnter><ModalHeader title="Rename" /></Modal>)
  expect(screen.getByRole('dialog').className).toContain('skipEnter')
  expect(css).toMatch(/\.skipEnter\[data-state='open'\] \{\s*animation: none/)
})


test('centred without a transform, so that scale grows from its middle', () => {
  expect(css).not.toMatch(/\.modal \{[^}]*transform:/)
})

describe('the strip of the window buttons', () => {
  const setWindowDimmed = vi.fn()
  // The strip hears of a change at the next frame; frames run in order, so one
  // asked for now comes after every change before it has been said.
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
  beforeEach(async () => {
    // Windows of the tests above close too.
    await nextFrame()
    vi.stubGlobal('electronAPI', { setWindowDimmed })
  })
  afterEach(async () => {
    cleanup()
    await nextFrame()
    vi.unstubAllGlobals()
    setWindowDimmed.mockClear()
  })
  const calls = () => setWindowDimmed.mock.calls.map(([dimmed]) => dimmed)

  test('dims while the window is open, from either way of closing', async () => {
    render(<Example />)
    await opened()
    await waitFor(() => expect(calls()).toEqual([true]))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(calls()).toEqual([true, false]))
  })

  test('stays dimmed when one window takes over from another', async () => {
    function Swap() {
      const [view, setView] = useState<'a' | 'b'>('a')
      return view === 'a'
        ? <Modal open><ModalHeader title="A" /><Button onClick={() => setView('b')}>Next</Button></Modal>
        : <Modal open skipEnter><ModalHeader title="B" /></Modal>
    }
    render(<Swap />)
    await waitFor(() => expect(calls()).toEqual([true]))
    await userEvent.click(button('Next'))
    await screen.findByRole('dialog', { name: 'B' })
    await nextFrame()
    expect(calls()).toEqual([true])
  })

  test('a preview does not dim the window', async () => {
    render(<Modal preview><ModalHeader title="Title" /></Modal>)
    await nextFrame()
    expect(setWindowDimmed).not.toHaveBeenCalled()
  })
})

function Nested() {
  const [outer, setOuter] = useState(true)
  const [inner, setInner] = useState(false)
  const [gone, setGone] = useState(false)
  return (
    <OverlayProvider>
      <Modal open={outer} onOpenChange={setOuter}>
        <ModalHeader title="Outer" />
        <ModalBody>
          {!gone && <Button onClick={() => setInner(true)}>Delete row</Button>}
          <Button>Other</Button>
        </ModalBody>
      </Modal>
      <Modal type="danger" open={inner} onOpenChange={setInner}>
        <ModalHeader title="Inner" />
        <ModalFooter confirm={{ children: 'Delete', onClick: () => { setGone(true); setInner(false) } }} />
      </Modal>
    </OverlayProvider>
  )
}

describe('a window over another', () => {
  test('Escape closes only the one on top, and focus goes back to what opened it', async () => {
    render(<Nested />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete row' }))
    await waitFor(() => expect(document.activeElement).toBe(button('Cancel')))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(button('Delete row')))
  })

  test('when what opened it is gone, focus goes to the window under it', async () => {
    render(<Nested />)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete row' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Outer' })))
  })
})
