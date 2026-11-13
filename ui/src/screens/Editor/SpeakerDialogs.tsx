import { useState } from 'react'
import type { SpeakerTarget } from '../../api/client'
import { useHandleSuggestion, useSpeakerCandidates, useSpeakers, useTranscript } from '../../api/queries'
import { effectiveSpeaker } from '../../api/types'
import { ChooseSpeakerModal } from '../../components/ChooseSpeakerModal/ChooseSpeakerModal'
import { NewSpeakerModal } from '../../components/NewSpeakerModal/NewSpeakerModal'
import { toast } from '../../components/Toast/toast-store'
import { hasSpeakerNamed, leastUsedColorIndex } from './new-speaker'
import { chooseSpeakerList, preselectedSpeaker } from './speaker-search'
import { handleProblem } from '../Speakers/handles'

// Someone asks who a speaker is: the review, a row of the inspector or a turn.
export interface SpeakerRequest {
  transcriptId: number
  // Whose voice the matches are for.
  speakerId: string
  start: 'choose' | 'new'
  preselected?: string | null
  onAssign: (target: SpeakerTarget) => Promise<void>
}

interface SpeakerDialogsProps {
  request: SpeakerRequest
  open?: boolean
  onClose: () => void
  onExited?: () => void
}

export function SpeakerDialogs({ request, open = true, onClose, onExited }: SpeakerDialogsProps) {
  const { transcriptId, speakerId, start, preselected = null, onAssign } = request
  const speakers = useSpeakers().data ?? []
  const transcript = useTranscript(transcriptId).data
  const candidates = useSpeakerCandidates(transcriptId).data?.[speakerId]?.candidates ?? []
  const [view, setView] = useState<{ name: 'choose'; query: string } | { name: 'new'; speakerName: string }>(
    start === 'choose' ? { name: 'choose', query: '' } : { name: 'new', speakerName: '' },
  )
  const [busy, setBusy] = useState(false)
  // The name as typed in New speaker, for the handle it brings.
  const [typedName, setTypedName] = useState<string | null>(null)
  const newName = typedName ?? (view.name === 'new' ? view.speakerName : '')
  const suggestedHandle = useHandleSuggestion(newName, undefined, view.name === 'new').data
  // One window turning into the other is not a new window.
  const [swapped, setSwapped] = useState(false)

  if (view.name === 'new') {
    return (
      <NewSpeakerModal
        initialName={view.speakerName}
        initialColorIndex={leastUsedColorIndex(speakers)}
        isNameTaken={name => hasSpeakerNamed(speakers, name)}
        suggestedHandle={suggestedHandle}
        onNameChange={setTypedName}
        checkHandle={handle => handleProblem(handle, speakers)}
        onCreate={async (name, colorIndex, handle) => {
          await onAssign(handle ? { name, colorIndex, handle } : { name, colorIndex })
          onClose()
        }}
        onBack={() => {
          if (start === 'new') onClose()
          else {
            setSwapped(true)
            setView({ name: 'choose', query: view.speakerName })
          }
        }}
        onClose={onClose}
        open={open}
        onExited={onExited}
        skipEnter={swapped}
      />
    )
  }

  const recordingSpeakers = transcript?.segments.map(effectiveSpeaker) ?? []
  return (
    <ChooseSpeakerModal
      list={(query, category) => chooseSpeakerList({ speakers, candidates, recordingSpeakers, query, category })}
      initialQuery={view.query}
      initialSelectedId={preselectedSpeaker(preselected, candidates)}
      busy={busy}
      onAssign={async id => {
        setBusy(true)
        try {
          await onAssign({ id })
          onClose()
        } catch (error) {
          setBusy(false)
          toast({ message: `Failed to assign the speaker: ${(error as Error).message}`, type: 'error' })
        }
      }}
      onNewSpeaker={name => {
        setSwapped(true)
        setTypedName(null)
        setView({ name: 'new', speakerName: name })
      }}
      onClose={onClose}
      open={open}
      onExited={onExited}
      skipEnter={swapped}
    />
  )
}
