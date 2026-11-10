import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { AddToQueueError, useAddToQueue, useModels } from '../../api/queries'
import { ApiError } from '../../api/client'
import { toast } from '../../components/Toast/toast-store'
import { readTranscribeSettings, type TranscribeSettings } from '../../platform/transcribe-defaults'
import { NOTHING_PICKED, transcribeChoice, type Picked } from '../../transcribe/choice'
import { apiLanguage } from '../../transcribe/languages'
import { useSettingsDialog } from '../Settings/SettingsProvider'
import { useRecordingSetup } from '../../recording/useRecordingSetup'
import { openModalCount } from '../../components/Modal/open-modals'
import type { ImportDialogProps } from './ImportDialog'
import type { NewRecordingDialogProps } from './NewRecordingDialog'
import { refusalOf, type Refusal } from '../../transcribe/refusals'
import {
  addFiles, defaultTitle, fileName, importingMessage, queueTitles, renameFile, skippedMessage, watchFileDrags, type ImportFile,
} from './import-files'

type Dialog = 'record' | 'import'

interface State {
  // Which of the two is open, if any: one takes the place of the other.
  open: Dialog | null
  // Import files stays until closed once opened from New recording, or once files were
  // dropped or chosen. Opened by a drag alone, it goes again when the drag leaves with
  // nothing dropped.
  sticky: boolean
  // Files were dragged over New recording: it comes back if they leave undropped.
  dragFrom: Dialog | null
  files: ImportFile[]
  // Typed in New recording. Model and language are the same in both dialogs; the title
  // goes to the first file added to Import files.
  title: string
  // Model and language picked for this run; the defaults until the user picks.
  picked: Picked
  failure: Refusal | null
  // Counts the openings from nothing open: each starts afresh.
  session: number
}

const CLOSED: Omit<State, 'session'> = { open: null, sticky: false, dragFrom: null, files: [], title: '', picked: NOTHING_PICKED, failure: null }

// A new opening, with nothing kept from the last one.
const opening = (current: State, open: Dialog, sticky: boolean): State => ({ ...CLOSED, open, sticky, session: current.session + 1 })

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

// Where a dropped file is on disk. Without Electron, or for something that is not a
// file on disk, there is no path and the file cannot be imported.
function pathOf(file: File): string {
  try {
    return bridge()?.getFilePath(file) ?? ''
  } catch {
    return ''
  }
}

// New recording and Import files, and the drags of files over the window that open
// Import files. Returns what the plus opens and the props of both dialogs.
export function useNewTranscription() {
  const [state, setState] = useState<State>({ ...CLOSED, session: 0 })
  const latest = useRef(state)
  latest.current = state
  const { mutateAsync: addToQueue, isPending } = useAddToQueue()
  // Files cannot be added while the list goes to the queue: it would close without them.
  // Set at once on Import, not on the next render.
  const importing = useRef(false)
  const api = useApi()
  const models = useModels()
  const { refetch: refetchModels } = models
  // Null until read: the dialog waits for the defaults rather than show others first.
  const [settings, setSettings] = useState<TranscribeSettings | null>(null)
  const [openedAt, setOpenedAt] = useState(() => api.now())
  const settingsDialog = useSettingsDialog()
  const recording = useRecordingSetup(state.open === 'record', state.session)
  const anyOpen = state.open !== null

  // Each opening starts from the last known catalog and asks for a fresh one, and
  // reads the defaults again: Settings may have changed them. Going from one dialog to
  // the other is not an opening.
  useEffect(() => {
    if (!anyOpen) return
    let current = true
    setOpenedAt(api.now())
    void refetchModels()
    void readTranscribeSettings().then(read => { if (current) setSettings(read) })
    return () => { current = false }
  }, [anyOpen, api, refetchModels])

  const choice = transcribeChoice(models.data, settings, state.picked)
  const latestChoice = useRef(choice)
  latestChoice.current = choice

  // Files dragged in are for Import files only when no other window is open over or
  // without it, such as Delete recording, or Settings opened from here. One of the two
  // is open at a time.
  const othersOpen = () => openModalCount() > (latest.current.open ? 1 : 0)

  const update = (next: State) => {
    latest.current = next
    setState(next)
  }

  const add = useCallback((incoming: ImportFile[]) => {
    if (importing.current) return
    const current = latest.current
    // A drop with nothing open starts a new list.
    const base = current.open ? current : opening(current, 'import', true)
    const listed = current.open === 'import' ? current.files : []
    const added = addFiles(listed, incoming)
    let { files } = added
    // A title typed in New recording names the first file added, and only that one.
    const typed = base.title.trim()
    if (typed && listed.length === 0 && files.length > 0) files = renameFile(files, files[0].path, typed)
    update({ ...base, open: 'import', sticky: true, dragFrom: null, files, title: files.length > 0 ? '' : base.title, failure: null })
    if (added.skipped.length > 0) toast({ message: skippedMessage(added.skipped) })
  }, [])

  // A drop that is not for the dialog is still taken by watchFileDrags, so the window
  // does not open the file, and goes nowhere.
  useEffect(() => watchFileDrags(window, {
    onEnter: () => {
      if (othersOpen()) return
      setState(current => {
        if (current.open === null) return opening(current, 'import', false)
        if (current.open === 'record') return { ...current, open: 'import', sticky: false, dragFrom: 'record' }
        return current
      })
    },
    onLeave: () => setState(current => {
      if (current.open !== 'import' || current.sticky || current.files.length > 0) return current
      return { ...current, open: current.dragFrom, dragFrom: null }
    }),
    onDrop: files => { if (!othersOpen()) add(files.map(file => ({ name: file.name, path: pathOf(file) }))) },
  }), [add])

  const openRecording = useCallback(() => setState(current => {
    if (current.open === 'import') return { ...current, sticky: true }
    return current.open ? current : opening(current, 'record', true)
  }), [])
  const toImport = useCallback(() => setState(current => ({ ...current, open: 'import', sticky: true, dragFrom: null })), [])
  const close = useCallback(() => setState(current => ({ ...current, open: null, dragFrom: null })), [])

  const chooseFiles = useCallback(async () => {
    if (importing.current) return
    const paths = await bridge()?.openFiles() ?? []
    if (paths.length > 0) add(paths.map(path => ({ name: fileName(path), path })))
  }, [add])

  // The refusal shown may have been about the file that went.
  const remove = useCallback((path: string) => setState(current => ({ ...current, files: current.files.filter(file => file.path !== path), failure: null })), [])

  const pick = useCallback((change: Partial<Picked>) => setState(current => ({ ...current, picked: { ...current.picked, ...change }, failure: null })), [])

  const importFiles = useCallback(async () => {
    const { files } = latest.current
    const { model, language, checking, blocked } = latestChoice.current
    if (checking || blocked) return
    const titles = queueTitles(files)
    importing.current = true
    try {
      await addToQueue({
        files: files.map((file, index) => ({ audioPath: file.path, title: titles[index] })),
        whisperModel: model,
        language: apiLanguage(language),
      })
      setState(current => ({ ...current, open: null }))
      toast({ message: importingMessage(files) })
    } catch (error) {
      const failure = error instanceof AddToQueueError ? error : new AddToQueueError(0, new ApiError(0, String(error)))
      // What went in is on its way: off the list, so Import does not send it twice.
      if (failure.added > 0) toast({ message: importingMessage(files.slice(0, failure.added)) })
      setState(current => ({ ...current, files: current.files.slice(failure.added), failure: refusalOf(failure.error) }))
    } finally {
      importing.current = false
    }
  }, [addToQueue])

  // Starts with the title typed, or the one the field shows; the dialog closes.
  const startRecording = () => {
    const { title } = latest.current
    const { model, language, checking, blocked } = latestChoice.current
    if (checking || blocked) return
    const started = recording.start({ title: title.trim() || defaultTitle(openedAt), model, language: apiLanguage(language) })
    if (started) setState(current => ({ ...current, open: null }))
  }

  const shared = {
    choice,
    onModelChange: (model: string) => pick({ model }),
    onLanguageChange: (language: string) => pick({ language }),
    onClose: close,
    // Over the dialog, which waits under Settings.
    onOpenSettings: (section: 'models' | 'alignment') => settingsDialog.open(section),
  }
  const record: NewRecordingDialogProps = {
    ...shared,
    open: state.open === 'record',
    title: state.title,
    defaultTitle: defaultTitle(openedAt),
    onTitleChange: title => setState(current => ({ ...current, title })),
    record: recording.setup,
    onStartRecording: startRecording,
    onImportFiles: toImport,
  }
  const importer: ImportDialogProps = {
    ...shared,
    open: state.open === 'import',
    files: state.files,
    onRename: (path, title) => setState(current => ({ ...current, files: renameFile(current.files, path, title) })),
    failure: state.failure,
    importing: isPending,
    onChooseFiles: () => void chooseFiles(),
    onRemove: remove,
    onImport: () => void importFiles(),
  }
  return { openRecording, record, importer }
}
