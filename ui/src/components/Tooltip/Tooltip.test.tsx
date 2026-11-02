import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { OverlayProvider } from '../../OverlayProvider'
import { Button } from '../Button/Button'
import { Tooltip, type TooltipPlacement } from './Tooltip'

afterEach(() => { vi.useRealTimers() })

const tip = (placement?: TooltipPlacement) => render(
  <OverlayProvider>
    <Tooltip text="Reassign speaker" placement={placement}><Button>Target</Button></Tooltip>
    <Tooltip text="Other tip"><Button>Other</Button></Tooltip>
  </OverlayProvider>,
)
const target = () => screen.getByRole('button', { name: 'Target' })
const passed = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

test('a pointer shows it after 400 ms', () => {
  vi.useFakeTimers()
  tip()
  fireEvent.pointerMove(target())
  passed(350)
  expect(screen.queryByRole('tooltip')).toBeNull()
  passed(100)
  expect(screen.getByRole('tooltip').textContent).toBe('Reassign speaker')
})

test('the next one right after another shows at once', () => {
  vi.useFakeTimers()
  tip()
  fireEvent.pointerMove(target())
  passed(450)
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
