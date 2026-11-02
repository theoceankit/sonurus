import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../components/Button/Button'
import { Inline } from '../components/Inline/Inline'
import { Stack } from '../components/Stack/Stack'
import styles from '../foundations/foundations.module.css'
import { useApi } from './ApiProvider'
import { WEEKLY_SYNC_ID } from './fixtures/data'
import { EVENT_SCRIPTS } from './fixtures/event-scripts'
import type { FixtureClient } from './fixtures/fixture-client'
import { useQueue, useQueueEventsSync, useSpeakerCandidates, useSpeakers, useTranscript, useTranscripts } from './queries'
import { effectiveSpeaker, type QueueUpdate } from './types'

type QueryState = { isPending: boolean; error: Error | null }

function State({ query, empty, children }: { query: QueryState; empty: boolean; children: React.ReactNode }) {
  if (query.isPending) return <span className={styles.name}>Loading</span>
  if (query.error) return <span className={styles.name}>Error: {query.error.message}</span>
  if (empty) return <span className={styles.name}>Empty</span>
  return children
}

function Data() {
  const transcripts = useTranscripts()
  const speakers = useSpeakers()
  const queue = useQueue()
  const weeklySync = useTranscript(WEEKLY_SYNC_ID)
  const candidates = useSpeakerCandidates(WEEKLY_SYNC_ID)
  const [events, setEvents] = useState<QueueUpdate[]>([])
  useQueueEventsSync(event => setEvents(current => [...current, event]))
  // Stories get a fixture client from the decorator in .storybook/preview.tsx.
  const client = useApi() as FixtureClient
  const nameOf = (id: string) => speakers.data?.find(s => s.id === id)?.name ?? 'Unknown speaker'

  return (
    <Stack gap={4} padding={4}>
      <Stack gap={1}>
        <div className={styles.heading}>Queue</div>
        <State query={queue} empty={false}>
          <span>{queue.data?.step ?? 'Idle'}, jobs: {queue.data?.jobs.length}</span>
        </State>
        <Inline gap={2}>
          <Button onClick={() => client.playEvents(EVENT_SCRIPTS.transcribing)}>Play a finished job</Button>
          <Button onClick={() => client.playEvents(EVENT_SCRIPTS.failed)}>Play a failed job</Button>
        </Inline>
        <span className={styles.name}>Events: {events.map(e => e.type).join(', ') || 'none'}</span>
      </Stack>
      <Stack gap={1}>
        <div className={styles.heading}>Recordings: {transcripts.data?.length ?? 0}</div>
        <State query={transcripts} empty={transcripts.data?.length === 0}>
          {transcripts.data?.slice(0, 4).map(t => <span key={t.id}>{t.title}, {t.duration}, {t.section}</span>)}
        </State>
      </Stack>
      <Stack gap={1}>
        <div className={styles.heading}>Speakers: {speakers.data?.length ?? 0}</div>
        <State query={speakers} empty={speakers.data?.length === 0}>
          <span>{speakers.data?.map(s => s.name ?? 'Unknown speaker').join(', ')}</span>
        </State>
      </Stack>
      <Stack gap={1}>
        <div className={styles.heading}>Weekly product sync</div>
        <State query={weeklySync} empty={false}>
          {weeklySync.data?.segments.slice(0, 5).map(s => <span key={s.start}>{nameOf(effectiveSpeaker(s))}: {s.text}</span>)}
        </State>
      </Stack>
      <Stack gap={1}>
        <div className={styles.heading}>Candidates</div>
        <State query={candidates} empty={Object.keys(candidates.data ?? {}).length === 0}>
          {Object.entries(candidates.data ?? {}).map(([id, list]) => (
            <span key={id}>{nameOf(id)}: {list.map(c => `${c.name} ${Math.round(c.score * 100)}%`).join(', ')}</span>
          ))}
        </State>
      </Stack>
    </Stack>
  )
}

const meta: Meta = { title: 'Foundations/API fixtures', component: Data }
export default meta

type Story = StoryObj

export const Review: Story = { parameters: { api: { board: 'review' } } }
export const ReviewDone: Story = { parameters: { api: { board: 'reviewDone' } } }
export const Unassigned: Story = { parameters: { api: { board: 'unassigned' } } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Empty: Story = { parameters: { api: { scenario: 'empty' } } }
export const ServerError: Story = { parameters: { api: { scenario: 'error' } } }
