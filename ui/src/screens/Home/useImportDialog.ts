import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { AddToQueueError, useAddToQueue, useModels } from '../../api/queries'
import { ApiError } from '../../api/client'
import { toast } from '../../components/Toast/toast-store'
import { readTranscribeSettings, transcribeSettings, type TranscribeSettings } from '../../platform/transcribe-defaults'
import { NOTHING_PICKED, transcribeChoice, type Picked } from '../../transcribe/choice'
import { apiLanguage } from '../../transcribe/languages'
import { useSettingsDialog } from '../Settings/SettingsProvider'
import { useRecordingSetup } from '../../recording/useRecordingSetup'
import type { ImportDialogProps } from './ImportDialog'
import {
  addFiles, defaultTitle, fileName, importFailure, importingMessage, queueTitles, skippedMessage, watchFileDrags, type ImportFailure, type ImportFile,
} from './import-files'

interface ImportState {
  open: boolean
  // Stays open until closed: opened by the button, or files were dropped or chosen.
  // Opened by a drag alone, it goes again when the drag leaves with nothing dropped.
  sticky: boolean
  files: ImportFile[]
  title: string
  // Model and language picked for this run; the defaults until the user picks.
  picked: Picked
  failure: ImportFailure | null
}

const CLOSED: ImportState = { open: false, sticky: false, files: [], title: '', picked: NOTHING_PICKED, failure: null }

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

// The import dialog and the drags of files over the window that open it. Returns
// what opens it from a button and the props of ImportDialog.
export function useImportDialog() {
  const [state, setState] = useState<ImportState>(CLOSED)
  const latest = useRef(state)
  latest.current = state
  const { mutateAsync: addToQueue, isPending } = useAddToQueue()
  const api = useApi()
  const models = useModels()
  const { refetch: refetchModels } = models
  const [settings, setSettings] = useState<TranscribeSettings>(() => transcribeSettings(undefined))
  const [openedAt, setOpenedAt] = useState(() => api.now())
  const settingsDialog = useSettingsDialog()
  const recording = useRecordingSetup(state.open)

  // Each opening starts from the last known catalog and asks for a fresh one, and
  // reads the defaults again: Settings may have changed them.
  useEffect(() => {
    if (!state.open) return
    let current = true
    setOpenedAt(api.now())
    void refetchModels()
    void readTranscribeSettings().then(read => { if (current) setSettings(read) })
    return () => { current = false }
  }, [state.open, api, refetchModels])

  const choice = transcribeChoice(models.data, settings, state.picked)
  const latestChoice = useRef(choice)
  latestChoice.current = choice

  const add = useCallback((incoming: ImportFile[]) => {
    // A drop on a closed dialog starts a new list.
    const { files, skipped } = addFiles(latest.current.open ? latest.current.files : [], incoming)
    latest.current = { ...latest.current, open: true, sticky: true, files, failure: null }
    setState(latest.current)
    if (skipped.length > 0) toast({ message: skippedMessage(skipped) })
  }, [])

  useEffect(() => watchFileDrags(window, {
    onEnter: () => setState(current => (current.open ? current : { ...CLOSED, open: true })),
    onLeave: () => setState(current => ({ ...current, open: current.open && (current.sticky || current.files.length > 0) })),
    onDrop: files => add(files.map(file => ({ name: file.name, path: pathOf(file) }))),
  }), [add])

  const open = useCallback(() => setState(current => (current.open ? { ...current, sticky: true } : { ...CLOSED, open: true, sticky: true })), [])
  const close = useCallback(() => setState(current => ({ ...current, open: false })), [])

  const chooseFiles = useCallback(async () => {
    const paths = await bridge()?.openFiles() ?? []
    if (paths.length > 0) add(paths.map(path => ({ name: fileName(path), path })))
  }, [add])

  const remove = useCallback((path: string) => setState(current => ({ ...current, files: current.files.filter(file => file.path !== path) })), [])

  const pick = useCallback((change: Partial<Picked>) => setState(current => ({ ...current, picked: { ...current.picked, ...change }, failure: null })), [])

  const importFiles = useCallback(async () => {
    const { files, title } = latest.current
    const { model, language, checking, blocked } = latestChoice.current
    if (checking || blocked) return
    const titles = queueTitles(files, title)
    try {
      await addToQueue({
        files: files.map((file, index) => ({ audioPath: file.path, title: titles[index] })),
        whisperModel: model,
        language: apiLanguage(language),
      })
      setState(current => ({ ...current, open: false }))
      toast({ message: importingMessage(files) })
    } catch (error) {
      const failure = error instanceof AddToQueueError ? error : new AddToQueueError(0, new ApiError(0, String(error)))
      // What went in is on its way: off the list, so Import does not send it twice.
      if (failure.added > 0) toast({ message: importingMessage(files.slice(0, failure.added)) })
      setState(current => ({ ...current, files: current.files.slice(failure.added), failure: importFailure(failure.error) }))
    }
  }, [addToQueue])

  // Starts with the title typed, or the one the field shows; the dialog closes.
  const startRecording = () => {
    const { title } = latest.current
    const { model, language, checking, blocked } = latestChoice.current
    if (checking || blocked) return
    const started = recording.start({ title: title.trim() || defaultTitle(openedAt), model, language: apiLanguage(language) })
    if (started) setState(current => ({ ...current, open: false }))
  }

  const dialog: ImportDialogProps = {
    open: state.open,
    files: state.files,
    title: state.title,
    defaultTitle: defaultTitle(openedAt),
    onTitleChange: title => setState(current => ({ ...current, title })),
    choice,
    onModelChange: model => pick({ model }),
    onLanguageChange: language => pick({ language }),
    failure: state.failure,
    importing: isPending,
    onChooseFiles: () => void chooseFiles(),
    onRemove: remove,
    onImport: () => void importFiles(),
    onClose: close,
    record: recording.setup,
    onStartRecording: startRecording,
    onOpenSettings: section => {
      close()
      settingsDialog.open(section)
    },
  }
  return { open, dialog }
}
