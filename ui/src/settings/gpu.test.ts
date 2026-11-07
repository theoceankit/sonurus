import { beforeEach, expect, test, vi } from 'vitest'
import { ApiError, type ApiClient } from '../api/client'
import { FIXTURE_GPU } from '../api/fixtures/data'
import type { GpuDownloadEvent, GpuRestartAnswer } from '../api/gpu-events'
import type { GpuStatus } from '../api/types'
import { toast } from '../components/Toast/toast-store'
import { createGpu, formatGpuSize, gpuSectionView, type GpuState } from './gpu'

vi.mock('../components/Toast/toast-store', () => ({ toast: vi.fn() }))
beforeEach(() => vi.mocked(toast).mockClear())
const lastToast = () => vi.mocked(toast).mock.lastCall?.[0]

const RTX = FIXTURE_GPU.gpu!
const status = (over: Partial<GpuStatus> = {}): GpuStatus => ({ ...FIXTURE_GPU, ...over })
const view = (s: GpuStatus | null, ui: Partial<Omit<GpuState, 'status'>> = {}) => gpuSectionView(s, { download: null, restart: null, restarting: false, ...ui })
const shown = (s: GpuStatus | null, ui: Partial<Omit<GpuState, 'status'>> = {}) => {
  const v = view(s, ui)
  if (v.hidden) throw new Error('hidden')
  return v
}

test('formatGpuSize', () => {
  expect(formatGpuSize(3920090829)).toBe('3.9 GB')
  expect(formatGpuSize(3470000000)).toBe('3.5 GB')
})

test('no section on macOS, nor before GET /gpu answered', () => {
  expect(view(status({ blocked_reason: 'unsupported_platform', gpu: null })).hidden).toBe(true)
  expect(view(null).hidden).toBe(true)
})

test('development build: no download, only the device', () => {
  const v = shown(status({ blocked_reason: 'not_packaged', device: 'cuda', torch: '2.8.0+cu128' }))
  expect(v.label).toBe('Development build')
  expect(v.device).toBe('GPU')
  expect(v.detail).toContain('PyTorch 2.8.0+cu128')
  expect(v.actions).toEqual([])
})

test.each([
  ['no_nvidia', null, 'No NVIDIA GPU found', /NVIDIA graphics card/],
  ['driver_too_old', { ...RTX, driver: '535.183.01' }, 'Driver update needed', /driver 535\.183\.01.*570 or newer/],
  ['gpu_too_old', { name: 'NVIDIA GeForce GTX 1060', driver: '581.29', compute_capability: '6.1' }, 'GPU not supported', /GTX 1060.*6\.1.*7\.0 or newer/],
] as const)('blocked: %s says why and offers no download', (reason, gpu, label, detail) => {
  const v = shown(status({ blocked_reason: reason, gpu }))
  expect(v.label).toBe(label)
  expect(v.detail).toMatch(detail)
  expect(v.device).toBe('CPU')
  expect(v.actions).toEqual([])
})

test('not installed: Download with its size', () => {
  const v = shown(status())
  expect(v.label).toBe('Not installed')
  expect(v.detail).toMatch(/RTX 4060/)
  expect(v.actions).toEqual([{ id: 'download', label: 'Download (3.9 GB)', primary: true }])
})

test('downloading: progress and Cancel; installing has no percentage', () => {
  let v = shown(status(), { download: { pct: 42, phase: 'download' } })
  expect(v.label).toBe('Downloading')
  expect(v.progress).toEqual({ pct: 42 })
  expect(v.actions).toEqual([{ id: 'cancel', label: 'Cancel', primary: false }])
  v = shown(status(), { download: { pct: 100, phase: 'install' } })
  expect(v.label).toBe('Installing')
  expect(v.progress).toBeNull()
  expect(v.actions.map(a => a.id)).toEqual(['cancel'])
})

test.each([
  [null, /Restarting the transcription engine/],
  ['transcription', /after the current transcription/],
  ['recording', /after the recording/],
  ['model_download', /after the model download/],
] as const)('waiting to restart (%s)', (reason, text) => {
  const v = shown(status({ state: 'pending_restart', pending: 'install' }), { restart: { reason } })
  expect(v.label).toBe('Waiting to apply')
  expect(v.detail).toMatch(text)
  expect(v.actions).toEqual([])
})

test('removal waiting to restart, and restarting', () => {
  expect(shown(status({ state: 'pending_restart', pending: 'remove' }), { restart: { reason: null } }).label).toBe('Removing')
  expect(shown(status({ state: 'pending_restart', pending: 'install' }), { restarting: true }).label).toBe('Restarting')
})

test('active: runs on the GPU, can be removed', () => {
  const v = shown(status({ state: 'active', device: 'cuda', torch: '2.8.0+cu128' }))
  expect(v.label).toBe('On')
  expect(v.tone).toBe('success')
  expect(v.device).toBe('GPU')
  expect(v.actions).toEqual([{ id: 'remove', label: 'Remove', primary: false }])
})

test('error: the reason, download again or remove', () => {
  const v = shown(status({ state: 'error', error: 'CUDA is not available to PyTorch' }))
  expect(v.label).toBe('GPU check failed')
  expect(v.tone).toBe('danger')
  expect(v.detail).toMatch(/CUDA is not available to PyTorch.*CPU/)
  expect(v.actions.map(a => [a.id, a.label])).toEqual([['download', 'Download again (3.9 GB)'], ['remove', 'Remove']])
})

test('stale after an app update: download the update or remove', () => {
  const v = shown(status({ state: 'stale' }))
  expect(v.label).toBe('Update needed')
  expect(v.detail).toMatch(/CPU/)
  expect(v.actions.map(a => [a.id, a.label])).toEqual([['download', 'Download update (3.9 GB)'], ['remove', 'Remove']])
})

test('an installed pack can be removed even when the GPU no longer qualifies', () => {
  expect(shown(status({ state: 'error', error: 'x', blocked_reason: 'driver_too_old', gpu: { ...RTX, driver: '535.1' } })).actions.map(a => a.id)).toEqual(['remove'])
})

// ── download and restart ──────────────────────────────────────────────────────

function setup({ statuses = [status()], restarts = [] as (GpuRestartAnswer | 409)[], removeResult = 'restart' as 'restart' | 'removed' } = {}) {
  const requests: string[] = []
  const timers: (() => void)[] = []
  let listener: ((event: GpuDownloadEvent) => void) | null = null
  const restartBackend = vi.fn(async () => {})
  const api = {
    getGpuStatus: async () => { requests.push('GET /gpu'); return statuses.length > 1 ? statuses.shift()! : statuses[0] },
    startGpuDownload: async () => { requests.push('POST /gpu/download'); return 'job-1' },
    cancelGpuDownload: async (id: string) => { requests.push(`DELETE /gpu/download/${id}`) },
    watchGpuDownload: (_id: string, listen: (event: GpuDownloadEvent) => void) => { listener = listen; return () => { listener = null } },
    removeGpuPack: async () => { requests.push(`DELETE /gpu/pack ${removeResult}`) },
    requestGpuRestart: async () => {
      requests.push('POST /gpu/restart')
      const next = restarts.shift() ?? { status: 'ready' }
      if (next === 409) throw new ApiError(409, 'Nothing to apply')
      return next
    },
  } as unknown as ApiClient
  const gpu = createGpu(api, { restartBackend, setTimer: run => { timers.push(run) } })
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  const tick = async () => { const run = timers.shift(); expect(run).toBeTruthy(); run!(); await flush() }
  const send = (event: GpuDownloadEvent) => listener?.(event)
  return { gpu, requests, timers, restartBackend, flush, tick, send, api }
}

test('download, progress, done, waits for the transcription, restarts, on', async () => {
  const env = setup({
    statuses: [status(), status({ state: 'pending_restart', pending: 'install' }), status({ state: 'active', device: 'cuda', torch: '2.8.0+cu128' })],
    restarts: [{ status: 'waiting', reason: 'transcription' }, { status: 'ready' }],
  })
  const seen: GpuState[] = []
  env.gpu.subscribe(() => seen.push(env.gpu.state()))
  await env.gpu.refresh()
  env.gpu.startDownload()
  await env.flush()
  expect(env.requests.slice(0, 2)).toEqual(['GET /gpu', 'POST /gpu/download'])
  env.send({ type: 'progress', phase: 'download', pct: 40 })
  expect(env.gpu.state().download).toEqual({ pct: 40, phase: 'download' })
  env.send({ type: 'progress', phase: 'install' })
  expect(env.gpu.state().download?.phase).toBe('install')
  env.send({ type: 'done' })
  await env.flush()
  expect(env.gpu.state().download).toBeNull()
  expect(env.gpu.state().status?.state).toBe('pending_restart')
  expect(env.requests).toContain('POST /gpu/restart')
  expect(env.gpu.state().restart).toEqual({ reason: 'transcription' })
  expect(env.restartBackend).not.toHaveBeenCalled()

  await env.tick()
  expect(env.restartBackend).toHaveBeenCalledOnce()
  expect(env.gpu.state()).toMatchObject({ restart: null, restarting: false, status: { state: 'active' } })
  expect(lastToast()).toEqual({ message: 'GPU acceleration is on' })
  expect(seen.some(s => s.restarting)).toBe(true)
  expect(env.timers).toEqual([])
})

test('a failed check after the restart is reported', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' }), status({ state: 'error', error: 'CUDA is not available to PyTorch' })] })
  await env.gpu.refresh()
  await env.flush()
  expect(env.restartBackend).toHaveBeenCalledOnce()
  expect(lastToast()).toEqual({ message: 'GPU check failed: CUDA is not available to PyTorch. Transcription runs on the CPU.', type: 'error' })
})

test('cancel a download', async () => {
  const env = setup()
  await env.gpu.refresh()
  env.gpu.startDownload()
  await env.flush()
  await env.gpu.cancelDownload()
  expect(env.requests).toContain('DELETE /gpu/download/job-1')
  expect(env.gpu.state().download).toBeNull()
})

test('a cancel before the backend answered stops the job it then starts', async () => {
  const env = setup()
  env.gpu.startDownload()
  await env.gpu.cancelDownload()
  await env.flush()
  expect(env.requests).toContain('DELETE /gpu/download/job-1')
  expect(env.gpu.state().download).toBeNull()
})

test('a failed download shows its reason', async () => {
  const env = setup()
  await env.gpu.refresh()
  env.gpu.startDownload()
  await env.flush()
  env.send({ type: 'error', message: 'Not enough disk space: 11.8 GB needed, 5.0 GB free' })
  await env.flush()
  expect(env.gpu.state().download).toBeNull()
  expect(lastToast()).toEqual({ message: 'GPU download failed: Not enough disk space: 11.8 GB needed, 5.0 GB free', type: 'error' })
})

test('remove an installed pack: restart, then CPU', async () => {
  const env = setup({ statuses: [status({ state: 'active', device: 'cuda' }), status({ state: 'pending_restart', pending: 'remove' }), status()] })
  await env.gpu.refresh()
  await env.gpu.remove()
  await env.flush()
  expect(env.requests).toContain('DELETE /gpu/pack restart')
  expect(env.restartBackend).toHaveBeenCalledOnce()
  expect(lastToast()).toEqual({ message: 'GPU acceleration removed. Transcription runs on the CPU.' })
})

test('remove a download not yet applied: no restart', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' }), status()], restarts: [{ status: 'waiting', reason: 'recording' }], removeResult: 'removed' })
  await env.gpu.refresh()
  await env.flush()
  await env.gpu.remove()
  await env.flush()
  expect(env.gpu.state().status?.state).toBe('not_installed')
  expect(env.gpu.state().restart).toBeNull()
  await env.tick()
  expect(env.restartBackend).not.toHaveBeenCalled()
})

test('nothing left to apply stops the restart loop', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' }), status()], restarts: [409] })
  await env.gpu.refresh()
  await env.flush()
  expect(env.restartBackend).not.toHaveBeenCalled()
  expect(env.gpu.state().restart).toBeNull()
  expect(env.timers).toEqual([])
})

test('a restart that fails is reported and tried again later', async () => {
  const env = setup({ statuses: [status({ state: 'pending_restart', pending: 'install' })] })
  env.restartBackend.mockRejectedValueOnce(new Error('Backend did not respond within 60 seconds'))
  await env.gpu.refresh()
  await env.flush()
  expect(lastToast()).toEqual({ message: 'Could not restart the transcription engine: Backend did not respond within 60 seconds', type: 'error' })
  expect(env.gpu.state().restarting).toBe(false)
  expect(env.timers).toHaveLength(1)
})

test('a refused removal is said, and the status is read again', async () => {
  const env = setup({ statuses: [status({ state: 'active', device: 'cuda' })] })
  ;(env.api as { removeGpuPack: () => Promise<void> }).removeGpuPack = async () => { throw new ApiError(409, 'Cancel the download first') }
  await env.gpu.remove()
  expect(lastToast()).toEqual({ message: 'Cancel the download first', type: 'error' })
  expect(env.requests).toContain('GET /gpu')
})
