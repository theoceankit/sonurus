export type Panel = 'sidebar' | 'inspector'

export interface PanelsState {
  sidebar: boolean
  inspector: boolean
  // Which one stays when only one fits.
  narrowKeeps: Panel
}

export const INITIAL_PANELS: PanelsState = { sidebar: true, inspector: true, narrowKeeps: 'sidebar' }

export const CENTER_MIN_WIDTH = 480
// Window padding and two gaps at 8, two side panels at 300, the smallest centre.
export const BOTH_PANELS_MIN_WIDTH = 1112

// The window padding and the gap of the right panel; the left panel with its gap.
const INSPECTOR_CHROME = 24
const SIDEBAR_TRACK = 308
export const INSPECTOR_MIN_WIDTH = 300

// The widest the right panel can be with the centre at its smallest.
export function inspectorMaxWidth(width: number, sidebarVisible: boolean) {
  const max = width - INSPECTOR_CHROME - (sidebarVisible ? SIDEBAR_TRACK : 0) - CENTER_MIN_WIDTH
  return Math.max(INSPECTOR_MIN_WIDTH, max)
}

// The width shown for the saved one. A narrower window changes only this, so the panel
// is back at the saved width when the window widens again.
export function shownInspectorWidth(saved: number | null, width: number, sidebarVisible: boolean) {
  if (typeof saved !== 'number' || !Number.isFinite(saved)) return INSPECTOR_MIN_WIDTH
  return Math.max(INSPECTOR_MIN_WIDTH, Math.min(Math.round(saved), inspectorMaxWidth(width, sidebarVisible)))
}

const bothFit = (width: number) => width >= BOTH_PANELS_MIN_WIDTH

export function visiblePanels(state: PanelsState, width: number): Record<Panel, boolean> {
  if (bothFit(width)) return { sidebar: state.sidebar, inspector: state.inspector }
  return {
    sidebar: state.sidebar && state.narrowKeeps === 'sidebar',
    inspector: state.inspector && state.narrowKeeps === 'inspector',
  }
}

// A panel hidden for lack of room counts as closed for its button: pressing it
// opens that panel and the other one gives way.
export function togglePanel(state: PanelsState, panel: Panel, width: number): PanelsState {
  const next = { ...state, [panel]: !visiblePanels(state, width)[panel] }
  if (bothFit(width)) return { ...next, narrowKeeps: next.sidebar ? 'sidebar' : 'inspector' }
  return next[panel] ? { ...next, narrowKeeps: panel } : next
}
