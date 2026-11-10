import { hasFiles } from '../../components/DropZone/DropZone'

// What the file dialog of Electron offers, and what a drop takes.
export const SUPPORTED_EXTENSIONS = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'webm'] as const

export interface ImportFile {
  name: string
  path: string
  // Renamed in the list: the title of its recording. Without one it is named after the file.
  title?: string
}

export const fileName = (path: string) => path.replace(/^.*[\\/]/, '')

export function isSupportedAudio(name: string | undefined): boolean {
  const extension = /\.([^./\\]+)$/.exec(name ?? '')?.[1]?.toLowerCase()
  return SUPPORTED_EXTENSIONS.some(supported => supported === extension)
}

// New files go to the end of the list. One already there is not added twice and not
// counted as skipped; one that is not audio or has no path on disk is skipped.
export function addFiles(current: readonly ImportFile[], incoming: readonly ImportFile[]): { files: ImportFile[]; skipped: string[] } {
  const files = [...current]
  const skipped: string[] = []
  for (const file of incoming) {
    if (!file.path || !isSupportedAudio(file.name)) skipped.push(file.name)
    else if (!files.some(other => other.path === file.path)) files.push(file)
  }
  return { files, skipped }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

// What the title field shows until the user types: "5 Nov 14:30 Meeting".
export const defaultTitle = (now: Date) => `${now.getDate()} ${MONTHS[now.getMonth()]} ${pad(now.getHours())}:${pad(now.getMinutes())} Meeting`

// The titles of the jobs, in the order of the files: the one a file was renamed to, or
// null, which the backend turns into the name of the file.
export const queueTitles = (files: readonly ImportFile[]): (string | null)[] => files.map(file => file.title ?? null)

// A file's name and its extension, which a rename leaves as it is.
export function splitName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: '' }
}

// Renames one file of the list. Blank, or its own name, it is named after the file again.
export function renameFile(files: readonly ImportFile[], path: string, typed: string): ImportFile[] {
  return files.map(file => {
    if (file.path !== path) return file
    const title = typed.trim()
    const named = { name: file.name, path: file.path }
    return title && title !== splitName(file.name).stem ? { ...named, title } : named
  })
}

export const importingMessage = (files: readonly ImportFile[]) => (
  files.length === 1 ? `Importing ${files[0].name}…` : `Importing ${files.length} files…`
)

// A toast: the dialog keeps only what will be imported.
export const skippedMessage = (names: readonly string[]) => (
  names.length === 1
    ? `${names[0]} was not imported: this file type is not supported.`
    : `${names.length} files were not imported: these file types are not supported.`
)

export interface FileDragHandlers {
  // Files came over the window.
  onEnter: () => void
  // They left it, or the drag was cancelled.
  onLeave: () => void
  onDrop: (files: File[]) => void
}

// Drags of files over the whole window. Drags of anything else, such as text, are left
// alone. A drop of files is always cancelled, also outside any zone: otherwise
// Electron would open the file in the window instead of the app.
export function watchFileDrags(target: Window, { onEnter, onLeave, onDrop }: FileDragHandlers): () => void {
  // Enter and leave come for every element crossed: only the first and the last count.
  let depth = 0
  const enter = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (++depth === 1) onEnter()
  }
  const leave = (event: DragEvent) => {
    if (!hasFiles(event)) return
    if (--depth > 0) return
    depth = 0
    onLeave()
  }
  const over = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth = 0
    onDrop(Array.from(event.dataTransfer?.files ?? []))
  }
  const listeners = { dragenter: enter, dragleave: leave, dragover: over, drop } as const
  for (const [type, listener] of Object.entries(listeners)) target.addEventListener(type, listener as EventListener)
  return () => {
    for (const [type, listener] of Object.entries(listeners)) target.removeEventListener(type, listener as EventListener)
  }
}
