import { createContext } from 'react'

// The place in the row of the tabs for the buttons of the tab shown. The note is a
// chunk of its own, so it puts its buttons there rather than handing them up.
export const InspectorActions = createContext<HTMLElement | null>(null)
