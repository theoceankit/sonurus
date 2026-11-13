import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type MutableRefObject } from 'react'
import { useApi } from '../../api/ApiProvider'
import { queryKeys, useHandleSuggestion, useSpeakerSample, useSpeakerTranscripts, useWaveform } from '../../api/queries'
import type { Speaker } from '../../api/types'
import { AppearanceRow } from '../../components/AppearanceRow/AppearanceRow'
import { Avatar } from '../../components/Avatar/Avatar'
import { ColorPicker } from '../../components/ColorPicker/ColorPicker'
import { IconButton } from '../../components/IconButton/IconButton'
import { Inline } from '../../components/Inline/Inline'
import { Menu, MenuAction } from '../../components/Menu/Menu'
import { ScrollBar } from '../../components/ScrollBar/ScrollBar'
import { MetaItem } from '../../components/MetaItem/MetaItem'
import { SectionHeader } from '../../components/SectionHeader/SectionHeader'
import { Stack } from '../../components/Stack/Stack'
import { TextField } from '../../components/TextField/TextField'
import { toast } from '../../components/Toast/toast-store'
import { VoiceClip } from '../../components/VoiceClip/VoiceClip'
import { BAR_COUNT } from '../../components/Waveform/bars'
import { SAMPLE_MAX_SECONDS, useSampleState, type SamplePlayback } from '../../media/sample-playback'
import { formatDuration } from '../../media/timeline'
import { markNotImplemented } from '../../not-implemented'
import { ASSIGNABLE_SPEAKER_COLORS, speakerColor } from '../../styles/speaker-colors'
import { hasSpeakerNamed } from '../Editor/new-speaker'
import { handleProblem, typedHandle } from './handles'
import { formatLastSeen, speakerUsage, type SpeakerDraft } from './speakers'
import styles from './SpeakersDialog.module.css'

const NAME_MAX_LENGTH = 128
const MAIN_SAMPLE = 'sample'

interface SpeakerCardProps {
  speaker: Speaker
  // Everyone else, to tell when the name is repeated.
  others: readonly Speaker[]
  sample: SamplePlayback
  // The name and colour as edited; nothing is saved until Save.
  draft: SpeakerDraft
  dirty: boolean
  saving: boolean
  // Why the last Save of a name was refused.
  saveError?: string
  // Why the last Save of a handle was refused.
  handleError?: string
  onDraftChange: (draft: SpeakerDraft) => void
  onSave: () => void
  onRevert: () => void
  // Why the speaker cannot be deleted now, or null.
  deleteBlocked: string | null
  onBack: () => void
  onOpenRecording: (id: number) => void
  onDelete: () => void
  // The dialog asks it first on Escape: true when it only took back the edits.
  cancelEdit: MutableRefObject<() => boolean>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

type NameFieldProps = Pick<SpeakerCardProps, 'speaker' | 'others' | 'draft' | 'dirty' | 'saving' | 'saveError' | 'onDraftChange' | 'onSave' | 'onRevert' | 'cancelEdit'>

// Enter saves the card, Escape takes its edits back; typing and leaving save nothing.
function NameField({ speaker, others, draft, dirty, saving, saveError, onDraftChange, onSave, onRevert, cancelEdit }: NameFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  cancelEdit.current = () => {
    if (document.activeElement !== input.current || !dirty) return false
    onRevert()
    return true
  }

  const saved = speaker.name ?? ''
  const trimmed = draft.name.trim()
  const repeated = trimmed && trimmed !== saved && hasSpeakerNamed(others, trimmed) ? `Another speaker is also named "${trimmed}".` : undefined
  const sameAlready = !repeated && speaker.name && hasSpeakerNamed(others, speaker.name) ? `Another speaker is also named "${speaker.name}".` : undefined

  return (
    <TextField
      ref={input}
      label="Name"
      placeholder="Add a name"
      maxLength={NAME_MAX_LENGTH}
      value={draft.name}
      readOnly={saving}
      helper={repeated ?? sameAlready}
      error={saveError}
      onChange={event => onDraftChange({ ...draft, name: event.target.value })}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSave()
        }
      }}
    />
  )
}

type HandleFieldProps = Pick<SpeakerCardProps, 'speaker' | 'others' | 'draft' | 'saving' | 'handleError' | 'onDraftChange' | 'onSave'>

// The handle as saved, or as typed. Until the field is typed in, a new name shows the
// handle it will bring, unless the handle was set by hand and stays. Emptied, the
// field shows the handle made from the name, which Save brings back.
function HandleField({ speaker, others, draft, saving, handleError, onDraftChange, onSave }: HandleFieldProps) {
  const name = draft.name.trim()
  const named = Boolean(name || speaker.name)
  const renamed = name !== '' && name !== (speaker.name ?? '')
  const follows = !speaker.handle_manual && draft.handle === null && renamed
  const fromName = useHandleSuggestion(name || speaker.name || '', speaker.id, follows || draft.handle === '').data
  const value = draft.handle ?? (follows ? fromName ?? speaker.handle : speaker.handle) ?? ''
  const problem = draft.handle ? handleProblem(draft.handle, others) : undefined
  const hint = !named ? 'Add a name first: the handle is made from it.'
    : draft.handle === '' ? 'Left empty, the handle is made from the name.'
      : undefined
  return (
    <TextField
      label="Handle"
      prefix="@"
      value={value}
      placeholder={draft.handle === '' ? fromName ?? '' : undefined}
      readOnly={saving || !named}
      helper={hint}
      error={handleError ?? problem}
      spellCheck={false}
      autoCapitalize="off"
      onChange={event => onDraftChange({ ...draft, handle: typedHandle(event.target.value) })}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSave()
        }
      }}
    />
  )
}

function VoiceSample({ speaker, sample }: Pick<SpeakerCardProps, 'speaker' | 'sample'>) {
  const api = useApi()
  const found = useSpeakerSample(speaker.id)
  const state = useSampleState(sample)
  const clip = found.data
  const end = clip ? Math.min(clip.end, clip.start + SAMPLE_MAX_SECONDS) : 0
  const [bars, setBars] = useState(BAR_COUNT.small)
  const levels = useWaveform(clip ? clip.transcript_id : null, { bars, start: clip?.start ?? 0, end })
  const playing = state.key === MAIN_SAMPLE

  if (found.isError || (!found.isPending && !clip)) {
    return (
      <p className={styles.hint}>
        {speaker.transcripts ? 'Audio unavailable: the recordings of this speaker were moved or deleted.' : 'Not in any recording yet.'}
      </p>
    )
  }
  return (
    <VoiceClip
      playing={playing && state.playing}
      progress={playing ? state.progress : 0}
      duration={formatDuration(end - (clip?.start ?? 0))}
      text={clip?.text.trim() ?? ''}
      disabled={!clip}
      heights={levels.data}
      onBarCount={setBars}
      onToggle={() => { if (clip) sample.toggle(MAIN_SAMPLE, api.getRecordingAudioUrl(clip.transcript_id), clip.start, clip.end) }}
    />
  )
}

function AppearsIn({ speaker, sample, onOpenRecording }: Pick<SpeakerCardProps, 'speaker' | 'sample' | 'onOpenRecording'>) {
  const api = useApi()
  const queries = useQueryClient()
  const recordings = useSpeakerTranscripts(speaker.id)
  const state = useSampleState(sample)

  const play = async (transcriptId: number) => {
    const key = `recording:${transcriptId}`
    try {
      const found = await queries.fetchQuery({
        queryKey: queryKeys.sample(speaker.id, transcriptId),
        queryFn: () => api.getSpeakerSample(speaker.id, transcriptId),
      })
      sample.toggle(key, api.getRecordingAudioUrl(transcriptId), found.start, found.end)
    } catch {
      toast({ message: 'The audio of this recording is unavailable.', type: 'error' })
    }
  }

  const rows = recordings.data ?? []
  return (
    <Stack gap={1}>
      <SectionHeader title="Appears in" meta={recordings.data ? String(rows.length) : undefined} />
      {recordings.isError && <p className={styles.hint}>Could not load the recordings: {message(recordings.error)}</p>}
      {recordings.data && rows.length === 0 && <p className={styles.hint}>Not in any recording yet.</p>}
      {rows.map(row => {
        const key = `recording:${row.id}`
        return (
          <AppearanceRow
            key={row.id}
            title={row.title}
            date={formatLastSeen(row.created_at)}
            audioMissing={!row.has_audio}
            playing={state.key === key && state.playing}
            onPlay={() => {
              // The same sample again pauses it, as a clip does.
              if (state.key === key) sample.toggle(key, api.getRecordingAudioUrl(row.id), 0, 0)
              else void play(row.id)
            }}
            onOpen={() => onOpenRecording(row.id)}
          />
        )
      })}
    </Stack>
  )
}

// One speaker, in place of the list: who they are, how they sound and where they talk.
export function SpeakerCard({ speaker, others, sample, draft, dirty, saving, saveError, handleError, onDraftChange, onSave, onRevert, deleteBlocked, onBack, onOpenRecording, onDelete, cancelEdit }: SpeakerCardProps) {
  const [area, setArea] = useState<HTMLElement | null>(null)
  const usage = speakerUsage(speaker)
  const named = Boolean(speaker.name)
  const color = speakerColor(draft.colorIndex)

  // While it cannot be done, Delete says why instead of asking.
  const remove = () => {
    if (deleteBlocked) toast({ message: deleteBlocked, type: 'error' })
    else onDelete()
  }

  return (
    <>
      <Stack ref={setArea} gap={4} className={styles.card}>
        <Inline justify="between">
          <IconButton icon="arrow-left" label="Back to speakers" onClick={onBack} />
          <Menu align="end" trigger={<IconButton icon="more" label="More" />}>
            <MenuAction icon="assign-speaker" {...markNotImplemented('speaker-card.merge')}>Merge into another speaker</MenuAction>
            <MenuAction icon="delete" onSelect={remove}>Delete speaker</MenuAction>
          </Menu>
        </Inline>
        <Inline gap={4} align="start">
          {named ? <Avatar name={speaker.name!} color={color} size="large" /> : <Avatar kind="unknown" size="large" />}
          <Stack gap={3} className={styles.fields}>
            <NameField speaker={speaker} others={others} draft={draft} dirty={dirty} saving={saving} saveError={saveError} onDraftChange={onDraftChange} onSave={onSave} onRevert={onRevert} cancelEdit={cancelEdit} />
            <HandleField speaker={speaker} others={others} draft={draft} saving={saving} handleError={handleError} onDraftChange={onDraftChange} onSave={onSave} />
          </Stack>
        </Inline>
        <Stack gap={1}>
          <SectionHeader title="Colour" />
          {named
            ? <ColorPicker aria-label="Colour" value={color} colors={ASSIGNABLE_SPEAKER_COLORS} disabled={saving} onValueChange={next => onDraftChange({ ...draft, colorIndex: next - 1 })} />
            : <p className={styles.hint}>Speakers without a name are grey. Add a name to choose a colour.</p>}
        </Stack>
        <Inline gap={4} wrap>
          <MetaItem icon="microphone">{usage.recordings}</MetaItem>
          {usage.time !== null && <MetaItem icon="clock">{formatDuration(usage.time)}</MetaItem>}
          <MetaItem icon="calendar">{`Last seen ${formatLastSeen(speaker.last_seen)}`}</MetaItem>
        </Inline>
        <Stack gap={1}>
          <SectionHeader title="Voice sample" />
          <VoiceSample speaker={speaker} sample={sample} />
        </Stack>
        <AppearsIn speaker={speaker} sample={sample} onOpenRecording={onOpenRecording} />
      </Stack>
      <ScrollBar area={area} />
    </>
  )
}
