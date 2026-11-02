import { Provider as TooltipGroup } from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { Toaster } from './components/Toast/Toast'

const TOOLTIP_DELAY = 400
const TOOLTIP_SKIP_DELAY = 300

// What overlays share across the app: one per window, around everything. The next
// tooltip right after another one shows at once.
export function OverlayProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipGroup delayDuration={TOOLTIP_DELAY} skipDelayDuration={TOOLTIP_SKIP_DELAY}>
      {children}
      <Toaster />
    </TooltipGroup>
  )
}
