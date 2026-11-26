import { scaleValue } from './scale'

// Times of the scale a script waits for. Not read from the page's styles: a build writes 250ms as .25s there.
// How long a side panel moves.
export const MOVE_DURATION = scaleValue('--duration-move')
export const SLOW_DURATION = scaleValue('--duration-slow')
export const BASE_DURATION = scaleValue('--duration-base')

// How long the pointer stays on a speaker before it is highlighted, and how long
// after a highlight the next one comes at once.
export const HOVER_DELAY = scaleValue('--delay-hover')
export const HOVER_SKIP = scaleValue('--delay-hover-skip')

// How long the pointer stays on a control before its tooltip shows, and how long
// after a tooltip the next one shows at once.
export const TOOLTIP_DELAY = scaleValue('--delay-tooltip')
export const TOOLTIP_SKIP = scaleValue('--delay-tooltip-skip')
