import { useCallback, useRef } from 'react'
import { useReadNote } from '../../api/queries'
import type { Speaker, Transcript } from '../../api/types'
import { noteMarkdown } from '../../components/NoteEditor/note-markdown'
import { toast } from '../../components/Toast/toast-store'
import type { ExportFormat } from '../../platform/electron-api'
import { settingsStore } from '../../platform/settings'
import { speakerFinder } from './note-speakers'
import type { TranscriptTurn } from './transcript'
import { exportContent, headingsBelowNotes } from './transcript-export'

// Export in the header: the format picked in its menu, with what Settings asks for, into
// the file picked in the save dialog.
// The note comes from the cache, which has what the editor holds, saved or not.
export function useTranscriptExport(transcript: Transcript, title: string, turns: readonly TranscriptTurn[], speakers: readonly Speaker[]) {
  const readNote = useReadNote()
  const running = useRef(false)
  const { id, language, diarized } = transcript

  return useCallback(async (format: ExportFormat) => {
    if (running.current) return
    running.current = true
    try {
      const settings = await settingsStore().read()
      let note: string | null | undefined
      if (settings.exportNotes) {
        const { content } = await readNote(id)
        note = content ? noteMarkdown(format === 'md' ? headingsBelowNotes(content) : content, speakerFinder(speakers)) || null : null
      }
      const text = exportContent(
        format,
        { title, language, turns, note, diarized },
        { timestamps: settings.exportTimestamps, speakers: settings.exportSpeakers, speakerLabel: settings.exportSpeakerLabel },
      )
      const result = await window.electronAPI.saveExport({ title, format, text })
      if (result.status === 'saved') toast({ message: 'Exported' })
      if (result.status === 'failed') toast({ message: `Failed to export: ${result.message}`, type: 'error' })
    } catch (error) {
      toast({ message: `Failed to export: ${error instanceof Error ? error.message : String(error)}`, type: 'error' })
    } finally {
      running.current = false
    }
  }, [id, language, diarized, title, turns, speakers, readNote])
}
