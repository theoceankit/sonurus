import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { Button } from './components/Button/Button'
import { Tab } from './components/Tab/Tab'
import { TabPanel, Tabs } from './components/Tabs/Tabs'
import { dismissAllToasts } from './components/Toast/toast-store'
import { Toaster } from './components/Toast/Toast'
import {
  findNotImplementedProblems, NOT_IMPLEMENTED, NOT_IMPLEMENTED_TOAST, notImplementedProps,
} from './not-implemented'
import baseCss from './styles/base.css?raw'

afterEach(() => act(() => dismissAllToasts()))

const toastShown = () => screen.queryAllByText(NOT_IMPLEMENTED_TOAST).some(el => el.closest('li'))
const toastCount = () => screen.queryAllByText(NOT_IMPLEMENTED_TOAST).filter(el => el.closest('li')).length

test('one text for every unimplemented control', () => {
  expect(NOT_IMPLEMENTED_TOAST).toBe('Not available yet')
})

test('a marked control is visible, marked and still reachable', () => {
  render(<Button {...notImplementedProps('titlebar.share')}>Share</Button>)
  const button = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement
  expect(button.dataset.notImplemented).toBe('titlebar.share')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.disabled).toBe(false)
})

test('the dimming comes from the attribute, and the cursor stays that of a disabled control', () => {
  expect(baseCss).toMatch(/\[data-not-implemented\] \{\s*opacity: var\(--opacity-disabled\);/)
  expect(baseCss).toMatch(/\[data-not-implemented\],\s*\[data-not-implemented\] \* \{\s*cursor: default !important;/)
})

test.each([
  ['Enter', '{Enter}'],
  ['Space', ' '],
])('a click and %s show the toast once and never reach the handler', async (_name, key) => {
  const onClick = vi.fn()
  render(<><Toaster /><Button {...notImplementedProps('titlebar.share')} onClick={onClick}>Share</Button></>)
  const button = screen.getByRole('button', { name: 'Share' })

  await userEvent.click(button)
  expect(toastCount()).toBe(1)
  act(() => dismissAllToasts())

  button.focus()
  await userEvent.keyboard(key)
  expect(toastCount()).toBe(1)
  expect(onClick).not.toHaveBeenCalled()
})

test('a click inside a marked container is stopped too', async () => {
  const onClick = vi.fn()
  render(
    <>
      <Toaster />
      <div {...notImplementedProps('settings.export')}>
        <Button onClick={onClick}>Export</Button>
      </div>
    </>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Export' }))
  expect(toastShown()).toBe(true)
  expect(onClick).not.toHaveBeenCalled()
})

test('a click elsewhere passes through untouched', async () => {
  const onClick = vi.fn()
  render(
    <>
      <Toaster />
      <Button {...notImplementedProps('titlebar.share')}>Share</Button>
      <Button onClick={onClick}>Other</Button>
    </>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Other' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(toastShown()).toBe(false)
})

const sections = () => (
  <>
    <Toaster />
    <Tabs
      aria-label="Sections"
      defaultValue="speakers"
      tabs={
        <>
          <Tab value="speakers">Speakers</Tab>
          <Tab value="chapters" {...notImplementedProps('editor.tab-chapters')}>Chapters</Tab>
          <Tab value="notes">Notes</Tab>
        </>
      }
    >
      <TabPanel value="speakers">Speakers panel</TabPanel>
      <TabPanel value="chapters">Chapters panel</TabPanel>
      <TabPanel value="notes">Notes panel</TabPanel>
    </Tabs>
  </>
)
const tab = (name: string) => screen.getByRole('tab', { name })
const selected = () => screen.getByRole('tab', { selected: true }).textContent

test('a marked tab does not switch on mousedown or click', async () => {
  render(sections())
  await userEvent.click(tab('Chapters'))
  expect(selected()).toBe('Speakers')
  expect(toastShown()).toBe(true)
})

test('arrow keys pass over a marked tab without selecting it', async () => {
  render(sections())
  await userEvent.click(tab('Speakers'))
  await userEvent.keyboard('{ArrowRight>}')
  await waitFor(() => expect(document.activeElement).toBe(tab('Chapters')))
  await userEvent.keyboard('{/ArrowRight}')
  expect(selected()).toBe('Speakers')

  fireEvent.keyDown(tab('Chapters'), { key: 'Enter' })
  expect(selected()).toBe('Speakers')

  await userEvent.keyboard('{ArrowRight>}')
  await waitFor(() => expect(selected()).toBe('Notes'))
  await userEvent.keyboard('{/ArrowRight}')
})

// ── The list and the calls ────────────────────────────────────────────────────

const sourceFiles = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sources = Object.entries(sourceFiles).map(([path, text]) => ({ path: path.slice(2), text }))

const file = (path: string, text: string) => ({ path, text })

test('the walk sees the sources', () => {
  expect(sources.map(s => s.path)).toContain('components/Button/Button.tsx')
})

test('the list and the calls in the sources agree', () => {
  expect(findNotImplementedProblems(sources, NOT_IMPLEMENTED)).toEqual([])
})

test('an id in the list needs exactly one call', () => {
  expect(findNotImplementedProblems([], ['titlebar.share'])).toEqual(['titlebar.share: 0 calls'])
  expect(findNotImplementedProblems([
    file('a.tsx', "markNotImplemented('titlebar.share')"),
    file('b.tsx', "markNotImplemented('titlebar.share')"),
  ], ['titlebar.share'])).toEqual(['titlebar.share: 2 calls, in a.tsx, b.tsx'])
  expect(findNotImplementedProblems([file('a.tsx', "markNotImplemented('titlebar.share')")], ['titlebar.share'])).toEqual([])
})

test('a call needs its id in the list', () => {
  expect(findNotImplementedProblems([file('a.tsx', "markNotImplemented('titlebar.share')")], []))
    .toEqual(['titlebar.share: not in the list, called in a.tsx'])
})

test('an id must be a plain string, or the calls cannot be checked', () => {
  expect(findNotImplementedProblems([file('a.tsx', 'markNotImplemented(id)')], []))
    .toEqual(['a.tsx: an id that is not a plain string'])
})

test('no control writes its own "not available" text', () => {
  expect(findNotImplementedProblems([file('a.tsx', "toast({ message: 'Not available yet' })")], []))
    .toEqual(['a.tsx: its own "not available" text'])
})

test('stories and tests do not count as calls', () => {
  expect(findNotImplementedProblems([
    file('a.stories.tsx', "markNotImplemented('titlebar.share')"),
    file('a.test.tsx', "markNotImplemented('titlebar.share')"),
  ], [])).toEqual([])
})
