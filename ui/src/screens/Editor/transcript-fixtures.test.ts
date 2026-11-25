import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Segment, Speaker } from '../../api/types'
import { buildTurns, transcriptText } from './transcript'

// Recordings shared with the backend (tests/test_transcript_text.py): the MCP
// server gives an agent the text Copy transcript gives the user. This editor is
// the reference: TRANSCRIPT_FIXTURES=write rewrites the .txt files from it
// instead of checking them. Tests run from ui/.
const DIR = resolve(process.cwd(), '../tests/fixtures/transcript')
const WRITE = process.env.TRANSCRIPT_FIXTURES === 'write'

interface Fixture {
  title: string
  diarized: boolean
  speakers: { id: string; name: string | null; handle: string | null }[]
  segments: Segment[]
}

const cases = readdirSync(DIR).filter(name => name.endsWith('.json')).sort()

function text(name: string): string {
  const fixture: Fixture = JSON.parse(readFileSync(join(DIR, name), 'utf8'))
  const speakers = fixture.speakers.map(speaker => ({ ...speaker, color_index: 0, segments: 1, transcripts: 1, duration_sec: 1 }) as Speaker)
  return transcriptText(fixture.title, buildTurns(fixture.segments, speakers), fixture.diarized)
}

describe('transcript fixtures shared with the backend', () => {
  test('there are fixtures', () => {
    expect(cases.length).toBeGreaterThan(5)
  })

  test.each(cases)('%s gives the text of its .txt', name => {
    const expected = join(DIR, name.replace(/\.json$/, '.txt'))
    if (WRITE) writeFileSync(expected, text(name) + '\n')
    else expect(text(name) + '\n').toBe(readFileSync(expected, 'utf8'))
  })
})
