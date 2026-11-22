import { createContext } from 'react'
import type { Group } from '../Tooltip/Tooltip'

// The place in the row of the tabs for the buttons of the tab shown. The note is a
// chunk of its own, so it puts its buttons there rather than handing them up. They
// share the tooltip of Close inspector next to them.
export const InspectorActions = createContext<{ element: HTMLElement; tooltips: Group } | null>(null)
