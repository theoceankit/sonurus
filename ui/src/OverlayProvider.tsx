import type { ReactNode } from 'react'
import { Toaster } from './components/Toast/Toast'

// What overlays share across the app: one per window, around everything.
export function OverlayProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
