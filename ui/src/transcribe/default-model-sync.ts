import { useEffect, useRef } from 'react'
import { useModels } from '../api/queries'
import type { ModelInfo } from '../api/types'
import { toast } from '../components/Toast/toast-store'
import { settingsStore } from '../platform/settings'
import { defaultModelChange, defaultModelMessage } from './models'

// Every new answer of GET /models works the
// default model out again, so "the first model downloaded" and "the default was
// deleted" are the same step. A change is saved with its history and said in a toast.
// The app's root calls it once; its first answer is the baseline.
export function useDefaultModelSync() {
  const models = useModels().data
  const previous = useRef<readonly ModelInfo[] | null>(null)
  useEffect(() => {
    if (!models || previous.current === models) return
    const before = previous.current
    previous.current = models
    const store = settingsStore()
    void store.read().then(saved => {
      const change = defaultModelChange(before, models, saved)
      if (!change) return
      void store.patch(change)
      toast({ message: defaultModelMessage(change.transcribeModel, models) })
    })
  }, [models])
}
