import { useSyncExternalStore } from 'react'
import { useApi } from '../api/ApiProvider'
import { ApiError, type ApiClient } from '../api/client'
import type { GpuDownloadEvent, GpuWaitReason } from '../api/gpu-events'
import type { GpuStatus } from '../api/types'
import { toast } from '../components/Toast/toast-store'

// GPU acceleration: GET /gpu, the CUDA download
// over WS /ws/gpu/{job}, its removal, and the restart of the backend that applies
// either. It belongs to the app, not to Settings: a download goes on and the restart
// still happens after Settings close.
//
// Restart: the backend says when it may restart (POST /gpu/restart: ready, or waiting
// for a transcription, a recording or a download, asked again every pollMs); then the
// main process restarts it and applies the change (electron/gpu-pack.js).

export const GPU_RESTART_POLL_MS = 3000

export type GpuDownload = { pct: number; phase: 'download' | 'install' }

export type GpuState = {
  // The last GET /gpu; null until it has answered.
  status: GpuStatus | null
  download: GpuDownload | null
  // While a restart waits: what for, null before the backend said. failed: the
  // restart itself failed, and waits for Try again (or the next start of the app).
  restart: { reason: GpuWaitReason | null; failed?: boolean } | null
  restarting: boolean
}

export type Gpu = {
  state(): GpuState
  refresh(): Promise<GpuStatus | null>
  startDownload(): void
  // After a restart that failed: asks the backend again and restarts it.
  retryRestart(): void
  cancelDownload(): Promise<void>
  remove(): Promise<void>
  subscribe(listener: () => void): () => void
}

type Options = { restartBackend: () => Promise<void>; pollMs?: number; setTimer?: (run: () => void, ms: number) => void }

export const formatGpuSize = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

export function createGpu(api: ApiClient, { restartBackend, pollMs = GPU_RESTART_POLL_MS, setTimer = (run, ms) => { setTimeout(run, ms) } }: Options): Gpu {
  let state: GpuState = { status: null, download: null, restart: null, restarting: false }
  let job: { id: string | null; stop?: () => void } | null = null
  // The running restart loop; a new one, or none, makes an old one stop.
  let loop = 0
  const listeners = new Set<() => void>()
  const set = (change: Partial<GpuState>) => {
    state = { ...state, ...change }
    listeners.forEach(listener => listener())
  }

  const refresh = async () => {
    try {
      set({ status: await api.getGpuStatus() })
    } catch {
      return state.status
    }
    if (state.status?.state === 'pending_restart') startLoop()
    else if (!state.restarting) stopLoop()
    return state.status
  }

  const startLoop = () => {
    // A failed restart is not tried again by itself: GET /gpu still says pending_restart.
    if (loop || state.restart?.failed) return
    const id = ++loop
    set({ restart: { reason: null } })
    void tick(id)
  }
  const stopLoop = () => {
    loop = 0
    if (state.restart) set({ restart: null })
  }

  const tick = async (id: number) => {
    if (loop !== id) return
    let answer
    try {
      answer = await api.requestGpuRestart()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Nothing left to apply, such as a download that was removed.
        stopLoop()
        await refresh()
        return
      }
      answer = { status: 'waiting' as const, reason: null }
    }
    if (loop !== id) return
    if (answer.status !== 'ready') {
      set({ restart: { reason: answer.reason ?? null } })
      setTimer(() => void tick(id), pollMs)
      return
    }
    const pending = state.status?.pending
    set({ restarting: true })
    try {
      await restartBackend()
    } catch (error) {
      loop = 0
      set({ restarting: false, restart: { reason: null, failed: true } })
      toast({ message: `Could not restart the transcription engine: ${(error as Error).message}`, type: 'error' })
      return
    }
    set({ restarting: false })
    stopLoop()
    const status = await refresh()
    if (status?.state === 'active') toast({ message: 'GPU acceleration is on' })
    else if (status?.state === 'error') toast({ message: `GPU check failed: ${status.error}. Transcription runs on the CPU.`, type: 'error' })
    else if (pending === 'remove') toast({ message: 'GPU acceleration removed. Transcription runs on the CPU.' })
  }

  const endDownload = () => {
    job?.stop?.()
    job = null
    set({ download: null })
  }

  const startDownload = () => {
    if (job) return
    const current = { id: null as string | null, stop: undefined as (() => void) | undefined }
    job = current
    set({ download: { pct: 0, phase: 'download' } })
    const failed = (message: string) => {
      if (job !== current) return
      endDownload()
      toast({ message: `GPU download failed: ${message}`, type: 'error' })
      void refresh()
    }
    api.startGpuDownload().then(id => {
      if (job !== current) {
        // Cancelled before the backend answered: stop the job it started.
        void api.cancelGpuDownload(id).catch(() => {})
        return
      }
      current.id = id
      current.stop = api.watchGpuDownload(id, (event: GpuDownloadEvent) => {
        if (job !== current) return
        if (event.type === 'progress') set({ download: event.phase === 'download' ? { pct: event.pct, phase: 'download' } : { pct: state.download?.pct ?? 100, phase: 'install' } })
        else if (event.type === 'error') failed(event.message)
        else {
          endDownload()
          void refresh()
        }
      })
    }, error => failed((error as Error).message))
  }

  const cancelDownload = async () => {
    const current = job
    if (!current) return
    if (current.id) await api.cancelGpuDownload(current.id).catch(() => {})
    if (job === current) endDownload()
  }

  const remove = async () => {
    try {
      await api.removeGpuPack()
    } catch (error) {
      // An unreachable backend says nothing; the status below says what is there.
      if (error instanceof ApiError && error.status !== 0) toast({ message: error.message, type: 'error' })
    }
    await refresh()
  }

  return {
    state: () => state,
    refresh,
    startDownload,
    retryRestart: () => {
      if (!state.restart?.failed) return
      set({ restart: null })
      startLoop()
    },
    cancelDownload,
    remove,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const restartBackend = () => window.electronAPI?.restartBackend() ?? Promise.resolve()

// One per client: the app has one, each story and test its own.
const stores = new WeakMap<ApiClient, Gpu>()

export function gpuFor(api: ApiClient): Gpu {
  let store = stores.get(api)
  if (!store) stores.set(api, store = createGpu(api, { restartBackend }))
  return store
}

// The GPU state, re-rendering on every change. Nothing is asked here: the GPU section
// asks GET /gpu when it opens.
export function useGpu(): { gpu: Gpu; state: GpuState } {
  const gpu = gpuFor(useApi())
  return { gpu, state: useSyncExternalStore(gpu.subscribe, gpu.state) }
}

// ── What the section shows ────────────────────────────────────────────────────

const WAIT_TEXT: Record<GpuWaitReason, string> = {
  transcription: 'Applies after the current transcription; the queue goes on afterwards.',
  recording: 'Applies after the recording.',
  model_download: 'Applies after the model download.',
  gpu_download: 'Applies after the download.',
}

export type GpuTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export type GpuAction = { id: 'download' | 'cancel' | 'remove' | 'retry'; label: string; primary: boolean }
export type GpuView =
  | { hidden: true }
  | { hidden: false; label: string; tone: GpuTone; detail: string; device: 'GPU' | 'CPU'; progress: { pct: number } | null; actions: GpuAction[] }

// Hidden on macOS (the backend says unsupported_platform) and until GET /gpu answered.
export function gpuSectionView(status: GpuStatus | null, ui: Omit<GpuState, 'status'>): GpuView {
  if (!status || status.blocked_reason === 'unsupported_platform') return { hidden: true }
  const gpu = status.gpu
  const size = status.download_size ? ` (${formatGpuSize(status.download_size)})` : ''
  const out = (label: string, tone: GpuTone, detail: string, actions: GpuAction[] = [], progress: { pct: number } | null = null): GpuView => ({
    hidden: false, label, tone, detail, progress, actions, device: status.device === 'cuda' ? 'GPU' : 'CPU',
  })
  const download = (label: string): GpuAction => ({ id: 'download', label: `${label}${size}`, primary: true })
  const remove: GpuAction = { id: 'remove', label: 'Remove', primary: false }

  if (status.blocked_reason === 'not_packaged') {
    return out('Development build', 'neutral', `GPU acceleration is downloaded by the installed app. This backend uses PyTorch ${status.torch}.`)
  }
  if (ui.download) {
    const cancel: GpuAction[] = [{ id: 'cancel', label: 'Cancel', primary: false }]
    return ui.download.phase === 'install'
      ? out('Installing', 'accent', 'Installing the CUDA build of PyTorch.', cancel)
      : out('Downloading', 'accent', 'Downloading the CUDA build of PyTorch.', cancel, { pct: ui.download.pct })
  }
  if (ui.restarting) return out('Restarting', 'accent', 'Restarting the transcription engine…')
  // A download is offered only while the GPU qualifies; removal always.
  const canDownload = !status.blocked_reason
  switch (status.state) {
    case 'pending_restart':
      if (ui.restart?.failed) {
        return out('Restart failed', 'danger', 'Could not restart the transcription engine. Try again, or restart Sonorus to apply the change.',
          [{ id: 'retry', label: 'Try again', primary: true }])
      }
      return out(status.pending === 'remove' ? 'Removing' : 'Waiting to apply', 'accent',
        (ui.restart?.reason && WAIT_TEXT[ui.restart.reason]) || 'Restarting the transcription engine…')
    case 'active':
      return out('On', 'success', `Transcription runs on ${gpu?.name ?? 'the GPU'}.`, [remove])
    case 'error':
      return out('GPU check failed', 'danger', `${status.error}. Transcription runs on the CPU.`,
        canDownload ? [download('Download again'), remove] : [remove])
    case 'stale':
      return out('Update needed', 'warning',
        'This version of Sonorus uses a different PyTorch. Download the update to use the GPU again; until then transcription runs on the CPU.',
        canDownload ? [download('Download update'), remove] : [remove])
  }
  switch (status.blocked_reason) {
    case 'no_nvidia':
      return out('No NVIDIA GPU found', 'neutral', 'Transcription runs on the CPU. GPU acceleration needs an NVIDIA graphics card.')
    case 'driver_too_old':
      return out('Driver update needed', 'warning',
        `${gpu?.name} has driver ${gpu?.driver}; GPU acceleration needs ${status.min_driver} or newer. Transcription runs on the CPU.`)
    case 'gpu_too_old':
      return out('GPU not supported', 'neutral',
        `${gpu?.name} (compute capability ${gpu?.compute_capability}) is too old: PyTorch needs ${status.min_compute_capability} or newer. Transcription runs on the CPU.`)
  }
  return out('Not installed', 'neutral', `Transcribe faster on ${gpu?.name ?? 'your NVIDIA GPU'}. Downloads the CUDA build of PyTorch once.`, [download('Download')])
}
