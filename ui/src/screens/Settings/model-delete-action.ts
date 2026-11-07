import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { queryKeys, useQueue } from '../../api/queries'
import type { ModelInfo } from '../../api/types'
import { toast } from '../../components/Toast/toast-store'
import { settingsStore } from '../../platform/settings'
import { IN_USE_BY_RUNNING, modelDeletePrompt, modelInUseByRunningJob, queuedJobsUsingModel } from '../../transcribe/model-delete'
import type { ConfirmPrompt } from './ConfirmDialog'

export type ModelToDelete = { model: ModelInfo; name: string; prompt: ConfirmPrompt }

// Deleting models from Settings, as the old UI did: at once when no queued job needs
// the model, after a confirmation when some do; not while the running transcription
// needs it (the backend says 409 too, which is shown as a toast).
export function useModelDelete() {
  const api = useApi()
  const queries = useQueryClient()
  const queue = useQueue().data
  const [toConfirm, setToConfirm] = useState<ModelToDelete | null>(null)

  const remove = useCallback(async (model: ModelInfo) => {
    try {
      await api.deleteModel(model.id)
    } catch (error) {
      toast({ message: (error as Error).message, type: 'error' })
      return
    }
    // The default language cannot be transcribed without its model.
    const store = settingsStore()
    if ((await store.read()).transcribeLang === model.id) {
      void store.patch({ transcribeLang: 'auto' })
      toast({ message: 'Default language changed to Detect automatically' })
    }
    // The default model follows the catalog (useDefaultModelSync).
    await queries.invalidateQueries({ queryKey: queryKeys.models })
  }, [api, queries])

  return {
    toConfirm,
    blocked: (model: ModelInfo) => (modelInUseByRunningJob(model, queue) ? IN_USE_BY_RUNNING : ''),
    request: (model: ModelInfo, name: string) => {
      const prompt = modelDeletePrompt(name, queuedJobsUsingModel(model, queue))
      if (prompt) setToConfirm({ model, name, prompt: { ...prompt, confirmLabel: 'Delete' } })
      else void remove(model)
    },
    confirm: () => (toConfirm ? remove(toConfirm.model) : Promise.resolve()),
    close: () => setToConfirm(null),
  }
}
