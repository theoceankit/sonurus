import { useMemo } from 'react'
import { useApi } from '../../api/ApiProvider'
import { useSpeakers, useTranscript } from '../../api/queries'
import { effectiveSpeaker, UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { Player } from '../../components/Player/Player'
import { useAudioPlayback, usePlayback, type Playback } from '../../media/playback'
import type { Turn } from '../../media/timeline'
import { speakerColor, type SpeakerColor } from '../../styles/speaker-colors'

const GRAY: SpeakerColor = 6

// Colours as on the avatars: a speaker without a name is gray.
export function playerTurns(segments: readonly Segment[], speakers: readonly Speaker[]): Turn[] {
  const known = new Map(speakers.map(speaker => [speaker.id, speaker]))
  return segments.map(segment => {
    const { start, end } = segment
    const speaker = effectiveSpeaker(segment)
    const found = known.get(speaker)
    return speaker !== UNASSIGNED && found?.name
      ? { start, end, speaker, name: found.name, color: speakerColor(found.color_index) }
      : { start, end, speaker, name: speaker === UNASSIGNED ? 'Unassigned' : 'Unknown speaker', color: GRAY }
  })
}

// The audio of the open recording. Speed and volume stay when another one opens.
export function useTranscriptPlayback(transcriptId: number | null): Playback {
  const api = useApi()
  const transcript = useTranscript(transcriptId).data
  return useAudioPlayback(transcriptId !== null && transcript ? api.getAudioUrl(transcript) : null)
}

// The player of the open recording.
export function EditorPlayer({ transcriptId, playback }: { transcriptId: number | null; playback: Playback }) {
  const api = useApi()
  const transcript = useTranscript(transcriptId).data
  const speakers = useSpeakers().data
  const state = usePlayback(playback)
  const turns = useMemo(
    () => (transcriptId !== null && transcript ? playerTurns(transcript.segments, speakers ?? []) : []),
    [transcriptId, transcript, speakers],
  )

  return (
    <Player
      state={state}
      turns={turns}
      disabled={state.status !== 'ready'}
      notice={transcriptId !== null && transcript && (state.status === 'error' || !api.getAudioUrl(transcript)) ? 'Audio file not found' : undefined}
      onToggle={playback.toggle}
      onSeek={playback.seek}
      onRateChange={playback.setRate}
      onVolumeChange={playback.setVolume}
    />
  )
}
