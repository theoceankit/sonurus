import { Provider as TooltipProvider } from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { Toaster } from './components/Toast/Toast'
import { TOOLTIP_DELAY, TOOLTIP_SKIP } from './styles/motion'

// What overlays share across the app: one per window, around everything. The next
// tooltip right after another one shows at once.
export function OverlayProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY} skipDelayDuration={TOOLTIP_SKIP}>
      {children}
      <Toaster />
    </TooltipProvider>
  )
}
