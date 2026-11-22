import { scaleValue } from './scale'

// How long a side panel moves. Not read from the page's styles: a build writes 250ms as .25s there.
export const MOVE_DURATION = scaleValue('--duration-move')

// How long the pointer stays on a speaker before it is highlighted, and how long
// after a highlight the next one comes at once.
export const HOVER_DELAY = scaleValue('--delay-hover')
export const HOVER_SKIP = scaleValue('--delay-hover-skip')

// How long the pointer stays on a control before its tooltip shows, and how long
// after a tooltip the next one shows at once.
export const TOOLTIP_DELAY = scaleValue('--delay-tooltip')
export const TOOLTIP_SKIP = scaleValue('--delay-tooltip-skip')
