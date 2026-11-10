import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { Button } from '../Button/Button'
import { Menu, MenuAction } from '../Menu/Menu'
import { Tooltip, TooltipGroup, type TooltipPlacement } from './Tooltip'

afterEach(() => { vi.useRealTimers() })

const tip = (placement?: TooltipPlacement) => render(
  <OverlayProvider>
    <Tooltip text="Reassign speaker" placement={placement}><Button>Target</Button></Tooltip>
    <Tooltip text="Other tip"><Button>Other</Button></Tooltip>
  </OverlayProvider>,
)
const target = () => screen.getByRole('button', { name: 'Target' })
const passed = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

test('a pointer shows it after 300 ms', () => {
  vi.useFakeTimers()
  tip()
  fireEvent.pointerMove(target())
  passed(250)
  expect(screen.queryByRole('tooltip')).toBeNull()
  passed(100)
  expect(screen.getByRole('tooltip').textContent).toBe('Reassign speaker')
})

test('the next one right after another shows at once', () => {
  vi.useFakeTimers()
  tip()
  fireEvent.pointerMove(target())
  passed(350)
  fireEvent.pointerMove(screen.getByRole('button', { name: 'Other' }))
  passed(10)
  expect(screen.getByRole('tooltip').textContent).toBe('Other tip')
})

test('keyboard focus shows it at once and names the control', async () => {
  tip()
  await userEvent.tab()
  expect(document.activeElement).toBe(target())
  expect(screen.getByRole('tooltip').textContent).toBe('Reassign speaker')
  expect(target().getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
})

test('Escape hides it', async () => {
  tip()
  await userEvent.tab()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('tooltip')).toBeNull()
})

describe('focus a menu gives back to its button', () => {
  const withMenu = () => render(
    <OverlayProvider>
      <Menu trigger={<Tooltip text="More actions"><Button>More</Button></Tooltip>}>
        <MenuAction>Rename</MenuAction>
      </Menu>
      <Button>Elsewhere</Button>
    </OverlayProvider>,
  )
  const more = () => screen.getByRole('button', { name: 'More' })
  const shown = () => screen.queryByRole('tooltip', { hidden: true })?.textContent ?? null

  test.each([
    ['Escape', () => userEvent.keyboard('{Escape}')],
    ['an item', () => userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))],
  ])('shows no tooltip after %s', async (_, close) => {
    withMenu()
    await userEvent.click(more())
    await close()
    await waitFor(() => expect(document.activeElement).toBe(more()))
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))
    expect(shown()).toBeNull()
  })

  test('keyboard focus on it afterwards shows the tooltip', async () => {
    withMenu()
    await userEvent.click(more())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(more()))
    await userEvent.tab()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(more())
    expect(shown()).toBe('More actions')
  })
})

test.each([
  ['above', 'top', true],
  ['below', 'bottom', true],
  ['none', 'top', false],
] as const)('placement %s asks for the %s side, arrow %s', async (placement, side, arrow) => {
  tip(placement)
  await userEvent.tab()
  const content = document.querySelector('[data-side]')
  expect(content?.getAttribute('data-side')).toBe(side)
  expect(Boolean(content?.querySelector('svg'))).toBe(arrow)
})

const group = () => render(
  <OverlayProvider>
    <TooltipGroup>
      <div>
        <Tooltip text="Back"><Button>Back</Button></Tooltip>
        <span data-testid="gap" />
        <Tooltip text="Forward"><Button>Forward</Button></Tooltip>
      </div>
    </TooltipGroup>
    <Button>Outside</Button>
  </OverlayProvider>,
)
const button = (name: string) => screen.getByRole('button', { name })
const tooltips = () => screen.queryAllByRole('tooltip').map(tooltip => tooltip.textContent)
// Radix places a tooltip once a promise has settled, and only then it takes over.
const waited = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })
// As a browser does: out of one element into the next, then a move over it.
const move = (from: Element, to: Element) => {
  fireEvent.pointerOut(from, { relatedTarget: to })
  fireEvent.pointerOver(to, { relatedTarget: from })
  fireEvent.pointerMove(to)
}

test('in a group the next control takes the tooltip at once, however long the last was shown', async () => {
  vi.useFakeTimers()
  group()
  fireEvent.pointerMove(button('Back'))
  await waited(350)
  expect(tooltips()).toEqual(['Back'])
  await waited(1000)
  move(button('Back'), button('Forward'))
  await waited(10)
  expect(tooltips()).toEqual(['Forward'])
  expect(button('Forward').getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
})

test('the tooltip of a group stays over a gap and goes once the pointer leaves the group', async () => {
  vi.useFakeTimers()
  group()
  fireEvent.pointerMove(button('Back'))
  await waited(350)
  move(button('Back'), screen.getByTestId('gap'))
  await waited(500)
  expect(tooltips()).toEqual(['Back'])
  move(screen.getByTestId('gap'), button('Outside'))
  await waited(500)
  expect(tooltips()).toEqual([])
})

test('a control of a group shows its tooltip again after the pointer has left it', async () => {
  vi.useFakeTimers()
  group()
  fireEvent.pointerMove(button('Back'))
  await waited(350)
  move(button('Back'), screen.getByTestId('gap'))
  move(screen.getByTestId('gap'), button('Outside'))
  await waited(1000)
  move(button('Outside'), button('Back'))
  await waited(350)
  expect(tooltips()).toEqual(['Back'])
})

test('keyboard focus passes the tooltip of a group to the next control', async () => {
  group()
  await userEvent.tab()
  expect(tooltips()).toEqual(['Back'])
  await userEvent.tab()
  expect(document.activeElement).toBe(button('Forward'))
  expect(tooltips()).toEqual(['Forward'])
  expect(button('Forward').getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
})
