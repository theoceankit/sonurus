import { useRef, useState, type DragEvent } from 'react'

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

// A picture dropped on an element: the first file, whatever it is (the caller says if
// it will do). Drags of anything else pass by. over is true while files are over it.
export function useFileDrop(onFile: (file: File) => void, enabled = true) {
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return
      event.preventDefault()
      if (++depth.current === 1) setOver(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return
      if (--depth.current > 0) return
      depth.current = 0
      setOver(false)
    },
    onDrop: (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return
      event.preventDefault()
      // Not the window's too: it would take the file for an import.
      event.stopPropagation()
      depth.current = 0
      setOver(false)
      const file = event.dataTransfer.files[0]
      if (file) onFile(file)
    },
  }
  return { over, handlers }
}
