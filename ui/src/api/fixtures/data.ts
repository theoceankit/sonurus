import type {
  QueueJob, QueueSnapshot, Segment, Speaker, SpeakerCandidates, Transcript, TranscriptListItem,
} from '../types'

// The data of the Editor boards. It has the shape the API has: what the boards
// show and the API does not know (pinned recordings, folders, chapters, notes,
// handles, invitees) is not here.

export const SPEAKER_IDS = {
  anna: '0b1a6c52-4f0e-4a39-9d57-3c1e8a7f1001',
  mark: '1c2b7d63-5a1f-4b4a-8e68-4d2f9b8a1002',
  lena: '2d3c8e74-6b2a-4c5b-9f79-5e3a0c9b1003',
  priya: '3e4d9f85-7c3b-4d6c-a08a-6f4b1dac1004',
  oliver: '4f5ea096-8d4c-4e7d-b19b-7a5c2ebd1005',
  sofia: '5a6fb1a7-9e5d-4f8e-82ac-8b6d3fce1006',
  olga: '6b7ac2b8-af6e-4a9f-93bd-9c7e4adf1007',
  daniel: '7c8bd3c9-ba7f-4bae-a4ce-ad8f5bea1008',
  emma: '8d9ce4da-cb8a-4cbf-b5df-be9a6cfb1009',
  hugo: '9eadf5eb-dc9b-4dca-86ea-cfab7d0c100a',
  ines: 'afbe06fc-edac-4edb-97fb-d0bc8e1d100b',
  jonas: 'b0cf170d-febd-4fec-a80c-e1cd9f2e100c',
  kate: 'c1da281e-afce-4afd-b91d-f2dea03f100d',
  unknown1: 'd2eb392f-b0df-4b0e-8a2e-03efb14a100e',
  unknown2: 'e3fc4a30-c1ea-4c1f-9b3f-14fac25b100f',
} as const

const { anna, mark, lena, priya, oliver, sofia, olga, daniel, emma, hugo, ines, jonas, kate, unknown1, unknown2 } = SPEAKER_IDS

const speaker = (id: string, name: string | null, colorIndex: number, transcripts: number): Speaker => ({
  id,
  name,
  color_index: colorIndex,
  transcripts,
  segments: transcripts * 12,
  duration_sec: transcripts * 310,
  last_seen: '2026-10-04T02:33:00',
})

// Named first by name, then unnamed: the order of GET /speakers.
export const SPEAKERS: Speaker[] = [
  speaker(anna, 'Anna Petrova', 0, 14),
  speaker(daniel, 'Daniel Brooks', 3, 4),
  speaker(emma, 'Emma Wilson', 4, 4),
  speaker(hugo, 'Hugo Martin', 0, 2),
  speaker(ines, 'Ines Costa', 1, 2),
  speaker(jonas, 'Jonas Weber', 2, 1),
  speaker(kate, 'Kate Nguyen', 3, 1),
  speaker(lena, 'Lena Kovacs', 2, 11),
  speaker(mark, 'Mark Ellis', 1, 8),
  speaker(olga, 'Olga Larsen', 2, 1),
  speaker(oliver, 'Oliver Grant', 3, 5),
  speaker(priya, 'Priya Shah', 4, 6),
  speaker(sofia, 'Sofia Ramos', 1, 3),
  speaker(unknown1, null, 0, 1),
  speaker(unknown2, null, 4, 2),
]

const segment = (start: number, end: number, text: string, resolved: string, raw = 'SPEAKER_00'): Segment => ({
  start,
  end,
  text,
  speaker_raw: raw,
  speaker_resolved: resolved,
  speaker_final: null,
  unassigned: false,
})

export const WEEKLY_SYNC_ID = 1

// Talk time as on the boards: Anna 0:19, Mark 0:11, Unknown speaker 1 0:09,
// Oliver 0:07, Lena 0:04, Sofia 0:03. Anna's last turn overlaps Sofia.
const weeklySyncSegments: Segment[] = [
  segment(0, 5, "Okay, let's get started. The main topic today is the release we shipped on Friday.", anna, 'SPEAKER_00'),
  segment(5, 8, 'Right. The queue work landed, and so far nobody has reported a crash.', mark, 'SPEAKER_01'),
  segment(8, 10, 'Retry for failed jobs works too, I checked it.', mark, 'SPEAKER_01'),
  segment(10, 16, 'Good. What about the import flow? I saw a couple of complaints about large files.', anna, 'SPEAKER_00'),
  segment(16, 25, 'That was me. Files over two hours took a long time to copy before the job even started.', unknown1, 'SPEAKER_02'),
  segment(27, 29, 'One more thing from design: the editor and the settings page use different button styles.', lena, 'SPEAKER_03'),
  segment(29, 31, 'I would like to fix that before the big redesign.', lena, 'SPEAKER_03'),
  segment(31, 38, 'Let me check the numbers and get back to you by Friday.', oliver, 'SPEAKER_04'),
  segment(38, 44, 'Then we can close the import question next week.', mark, 'SPEAKER_01'),
  segment(44, 47, 'I can pick up the button styles.', sofia, 'SPEAKER_05'),
  segment(45, 53, "Great, thanks everyone. That's all for today.", anna, 'SPEAKER_00'),
]

export const weeklySync = (segments: Segment[] = weeklySyncSegments): Transcript => ({
  id: WEEKLY_SYNC_ID,
  audio_path: '/fixtures/weekly-product-sync.wav',
  language: 'en',
  status: 'done',
  title: 'Weekly product sync',
  segments,
})

const listItem = (id: number, title: string, createdAt: string, section: string, duration: string, speakers: string[]): TranscriptListItem => ({
  id,
  title,
  created_at: createdAt,
  status: 'done',
  speakers,
  section,
  duration,
})

const LAST_WEEK = 'Last week'

// Newest first, the order of GET /transcripts. Today is 5 October 2026 here.
export const TRANSCRIPTS: TranscriptListItem[] = [
  listItem(2, 'Design review', '2026-10-05T11:20:00', 'Today', '42 min', [lena, unknown2, oliver, sofia, mark]),
  listItem(3, 'Interview: onboarding feedback', '2026-10-05T09:05:00', 'Today', '28 min', [lena, unknown2, priya, anna, mark]),
  listItem(WEEKLY_SYNC_ID, 'Weekly product sync', '2026-10-04T02:33:00', 'Yesterday', '0 min', [anna, mark, unknown1, oliver, sofia, lena]),
  listItem(4, 'Call with Mark', '2026-10-03T16:40:00', LAST_WEEK, '19 min', [mark, anna, lena, oliver, priya]),
  listItem(5, 'Customer call, Acme', '2026-10-02T14:00:00', LAST_WEEK, '36 min', [oliver, kate, mark, anna, lena]),
  listItem(6, 'Silent test recording', '2026-09-26T10:12:00', 'Sep 26, 2026', '2 min', [anna, mark, lena, oliver, priya]),
  listItem(7, 'Archived partner call', '2026-09-24T15:30:00', 'Sep 24, 2026', '51 min', [oliver, mark, lena, anna, priya]),
  listItem(8, 'Roadmap planning, Q4', '2026-09-22T11:00:00', 'Sep 22, 2026', '1h 12m', [anna, lena, mark, oliver, priya]),
  listItem(9, '1:1 with Lena', '2026-09-21T09:30:00', 'Sep 21, 2026', '24 min', [lena, anna]),
  listItem(10, 'Sprint retro, September', '2026-09-18T17:00:00', 'Sep 18, 2026', '47 min', [oliver, mark, lena, anna, priya]),
  listItem(11, 'Hiring sync, design', '2026-09-16T13:15:00', 'Sep 16, 2026', '31 min', [anna, lena, mark, emma, hugo]),
  listItem(12, 'Investor update draft', '2026-09-15T10:00:00', 'Sep 15, 2026', '18 min', [lena, anna, mark, daniel, ines]),
  listItem(13, 'Onboarding call, Beta', '2026-09-11T16:20:00', 'Sep 11, 2026', '39 min', [anna, mark, lena, jonas, olga]),
  listItem(14, 'Team offsite planning', '2026-09-09T12:00:00', 'Sep 09, 2026', '55 min', [oliver, mark, lena, anna, sofia]),
  listItem(15, 'Support escalation review', '2026-09-07T15:45:00', 'Sep 07, 2026', '22 min', [anna, lena, mark, priya, oliver]),
  listItem(16, 'Podcast episode 12', '2026-09-03T18:00:00', 'Sep 03, 2026', '1h 04m', [lena, anna, kate, daniel, emma]),
  listItem(17, 'Quarterly numbers', '2026-09-01T09:00:00', 'Sep 01, 2026', '33 min', [priya, mark, anna, lena, oliver]),
]

const candidate = (speakerId: string, name: string, score: number) => ({ speaker_id: speakerId, name, score })

// Four speakers to review, with the percentages of the review card. The API
// suggests only for unrecognized speakers and gives one candidate each; three
// candidates and a possible match on a recognized speaker are what the design
// asks of the backend, so this is the shape it will have, not what it does now.
export const CANDIDATES: SpeakerCandidates = {
  [unknown1]: [candidate(mark, 'Mark Ellis', 0.82), candidate(lena, 'Lena Kovacs', 0.41), candidate(priya, 'Priya Shah', 0.12)],
  [sofia]: [candidate(sofia, 'Sofia Ramos', 0.71), candidate(priya, 'Priya Shah', 0.28), candidate(lena, 'Lena Kovacs', 0.15)],
  [oliver]: [candidate(oliver, 'Oliver Grant', 0.64), candidate(mark, 'Mark Ellis', 0.31), candidate(priya, 'Priya Shah', 0.18)],
  [lena]: [candidate(lena, 'Lena Kovacs', 0.58), candidate(priya, 'Priya Shah', 0.33), candidate(sofia, 'Sofia Ramos', 0.2)],
}

export const queueSnapshot = (changes: Partial<QueueSnapshot> = {}): QueueSnapshot => ({
  type: 'snapshot',
  paused: false,
  paused_by_recording: false,
  recording: false,
  start_mode: 'auto',
  running_job_id: null,
  step: null,
  jobs: [],
  ...changes,
})

export const QUEUE_JOB: QueueJob = {
  id: 'f4ad5b41-d2fb-4d2a-ac4a-25abd36c1010',
  audio_path: '/fixtures/planning-call.wav',
  title: 'Planning call',
  whisper_model: 'large-v3',
  language: null,
  status: 'waiting',
  error: null,
  error_code: null,
  error_language: null,
  created_at: '2026-10-05T12:00:00',
}

// What the job in the event scripts turns into.
export const PLANNING_CALL_ID = 18

export const PLANNING_CALL_ITEM = listItem(PLANNING_CALL_ID, 'Planning call', '2026-10-05T12:00:00', 'Today', '1 min', [anna, mark])

export const PLANNING_CALL: Transcript = {
  id: PLANNING_CALL_ID,
  audio_path: QUEUE_JOB.audio_path,
  language: 'en',
  status: 'done',
  title: 'Planning call',
  segments: [
    segment(0, 4, 'Shall we go through the plan for next week?', anna, 'SPEAKER_00'),
    segment(4, 9, 'Yes, the import work comes first.', mark, 'SPEAKER_01'),
  ],
}
