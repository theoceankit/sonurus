import { expect, test } from 'vitest'
import { parseTokens } from '../../styles/tokens'
import css from '../../styles/tokens.css?raw'
import { BOTH_PANELS_MIN_WIDTH, CENTER_MIN_WIDTH, INITIAL_PANELS, togglePanel, visiblePanels } from './panels'

const WIDE = 1200
const NARROW = 900

const both = { sidebar: true, inspector: true }
const onlySidebar = { sidebar: true, inspector: false }
const onlyInspector = { sidebar: false, inspector: true }
const neither = { sidebar: false, inspector: false }

test('the boundary is two side panels, the gaps, the window padding and the smallest centre', () => {
  const scale = parseTokens(css).scale
  const px = (name: string) => parseInt(scale.find(t => t.name === name)!.value, 10)
  expect(BOTH_PANELS_MIN_WIDTH).toBe(px('--space-2') * 4 + px('--size-panel-side') * 2 + CENTER_MIN_WIDTH)
  expect(BOTH_PANELS_MIN_WIDTH).toBe(1112)
})

test('both panels fit from the boundary up', () => {
  expect(visiblePanels(INITIAL_PANELS, WIDE)).toEqual(both)
  expect(visiblePanels(INITIAL_PANELS, BOTH_PANELS_MIN_WIDTH)).toEqual(both)
})

test('below the boundary the inspector goes first', () => {
  expect(visiblePanels(INITIAL_PANELS, BOTH_PANELS_MIN_WIDTH - 1)).toEqual(onlySidebar)
  expect(visiblePanels(INITIAL_PANELS, NARROW)).toEqual(onlySidebar)
})

test('opening the inspector on a narrow window hides the sidebar, and back', () => {
  const inspector = togglePanel(INITIAL_PANELS, 'inspector', NARROW)
  expect(visiblePanels(inspector, NARROW)).toEqual(onlyInspector)
  const sidebar = togglePanel(inspector, 'sidebar', NARROW)
  expect(visiblePanels(sidebar, NARROW)).toEqual(onlySidebar)
})

test('closing a panel on a narrow window does not bring up the other one', () => {
  expect(visiblePanels(togglePanel(INITIAL_PANELS, 'sidebar', NARROW), NARROW)).toEqual(neither)
})

test('widening brings back what was hidden only for lack of room', () => {
  const inspector = togglePanel(INITIAL_PANELS, 'inspector', NARROW)
  expect(visiblePanels(inspector, WIDE)).toEqual(both)
})

test('widening does not bring back a panel the user closed', () => {
  const closed = togglePanel(INITIAL_PANELS, 'sidebar', NARROW)
  expect(visiblePanels(closed, WIDE)).toEqual(onlyInspector)
})

test('on a wide window each panel toggles by itself', () => {
  const closed = togglePanel(INITIAL_PANELS, 'inspector', WIDE)
  expect(visiblePanels(closed, WIDE)).toEqual(onlySidebar)
  expect(visiblePanels(togglePanel(closed, 'inspector', WIDE), WIDE)).toEqual(both)
})

test('the one panel left open on a wide window stays when the window narrows', () => {
  expect(visiblePanels(togglePanel(INITIAL_PANELS, 'sidebar', WIDE), NARROW)).toEqual(onlyInspector)
  expect(visiblePanels(togglePanel(INITIAL_PANELS, 'inspector', WIDE), NARROW)).toEqual(onlySidebar)
})

test('reopening on a wide window still gives way to the sidebar when it narrows', () => {
  const closed = togglePanel(INITIAL_PANELS, 'inspector', WIDE)
  expect(visiblePanels(togglePanel(closed, 'inspector', WIDE), NARROW)).toEqual(onlySidebar)
})
