import { useCallback, useEffect, useRef, useState } from 'react'
import { AddToQueueError, useAddToQueue } from '../../api/queries'
import { ApiError } from '../../api/client'
import { toast } from '../../components/Toast/toast-store'
import type { ImportDialogProps } from './ImportDialog'
import { addFiles, fileName, importFailure, importingMessage, skippedMessage, watchFileDrags, type ImportFailure, type ImportFile } from './import-files'

interface ImportState {
  open: boolean
  // Stays open until closed: opened by the button, or files were dropped or chosen.
  // Opened by a drag alone, it goes again when the drag leaves with nothing dropped.
  sticky: boolean
  files: ImportFile[]
  failure: ImportFailure | null
}

const CLOSED: ImportState = { open: false, sticky: false, files: [], failure: null }

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

  const importFiles = useCallback(async () => {
    const { files } = latest.current
    try {
      await addToQueue(files.map(file => file.path))
      setState(current => ({ ...current, open: false }))
      toast({ message: importingMessage(files) })
    } catch (error) {
      const failure = error instanceof AddToQueueError ? error : new AddToQueueError(0, new ApiError(0, String(error)))
      // What went in is on its way: off the list, so Import does not send it twice.
      if (failure.added > 0) toast({ message: importingMessage(files.slice(0, failure.added)) })
      setState(current => ({ ...current, files: current.files.slice(failure.added), failure: importFailure(failure.error) }))
    }
  }, [addToQueue])

  const dialog: ImportDialogProps = {
    open: state.open,
    files: state.files,
    failure: state.failure,
    importing: isPending,
    onChooseFiles: () => void chooseFiles(),
    onRemove: remove,
    onImport: () => void importFiles(),
    onClose: close,
  }
  return { open, dialog }
}
