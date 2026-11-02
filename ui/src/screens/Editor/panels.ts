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
