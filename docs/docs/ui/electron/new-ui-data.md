---
sidebar_position: 4
---

# New UI data

How screens of the new UI in `ui/` get their data. A screen calls hooks and does not see what is behind them, so it moves from fixtures to the backend without a change.

```
screen → ui/src/api/queries.ts (TanStack Query) → useApi() → ApiClient
                                                              ├─ backend-client.ts  → the API
                                                              └─ fixtures/fixture-client.ts
```

`main.tsx` picks the client and passes it to `ApiProvider`. Storybook gives each story its own fixture client.

## Types

The types come from the backend's schema, in three steps:

| File | Made from | Checked by |
|---|---|---|
| `ui/src/api/openapi.json` | `build_schema()` in `app/api/openapi_schema.py` | `tests/test_openapi_schema.py` |
| `ui/src/api/schema.gen.ts` | `openapi.json`, by `openapi-typescript` | `npm --prefix ui/tools/openapi-types run check` in CI |
| `ui/src/api/backend-client.ts` | written by hand against `schema.gen.ts` | `npm --prefix ui run typecheck` |

After a change to a route or a schema:

```bash
npm --prefix ui/tools/openapi-types ci   # once
npm run gen:api
```

Both files are committed. The schema is FastAPI's own with two differences: it has no version, or every release would change the file, and it adds the events of `WS /ws/queue` (`JobDoneEvent`, `JobFailedEvent`, `HeartbeatEvent`), which OpenAPI cannot describe. The queue sends them as plain dicts, and a test holds the real events to these models. `GET /openapi.json` stays as FastAPI makes it.

Response models that extend `ResponseModel` list fields with a default as required: such a field is always in the response.

The generator is a package of its own in `ui/tools/openapi-types/` because it needs TypeScript 5 and the new UI is on 7. It is a development tool and is not packaged.

## Client

`ApiClient` in `ui/src/api/client.ts` lists what screens can ask of the backend. It covers what the Editor needs; a screen that needs more adds a method to both implementations. Failures are `ApiError` with `status` (`0` when the backend did not answer) and `message`, which is the `detail` of the response or `Server error N`.

`getAudioUrl` is what an audio element plays for a recording, or null when there is nothing to play. On the backend it is a `file://` URL of `audio_path`.

`getSpeakerCandidates` gives, per unrecognized speaker, up to three candidates and a clip of the voice, as `GET /transcripts/{id}/speaker-candidates` answers. A speaker with no candidates is still in the answer, for its clip. The fixtures also give candidates to recognized speakers for the Possible match state in Storybook; the API does not.

`undoSpeakerAssignment({ transcriptId, segmentStarts, speakerId })` puts segments back under the speaker they had before an assignment, and works on fixtures, where it also brings back the candidates and the clip. A reassign the other way would not do: it moves every segment of the new speaker, and a voice left with no segments is gone from speaker memory. The backend has no route for it yet, so the backend client rejects with status 501.

`now()` is today for the screens: the current time on the backend client, 5 October 2026 on fixtures, so that sections of the recordings list stay as on the design boards.

A speaker's `color_index` counts from 0. `speakerColor()` in `ui/src/styles/speaker-colors.ts` turns it into a colour of the avatars. The fixtures use the colours of the boards.

## Queue events

`subscribeQueueEvents` gives the current snapshot and then every snapshot and job event. `queue-events.ts` connects to `WS /ws/queue`, reconnects two seconds after the connection drops and does not pass heartbeats on.

`useQueueEventsSync()`, called once at the root of the app, puts snapshots into the cache behind `useQueue()` and refreshes the recordings and speakers on `job_done`. Its optional callback is for what a screen shows itself, such as a toast on `job_failed`.

## Hooks

`queries.ts` has one hook per read and per change. A change refreshes what it affects. Queries do not retry and do not refetch on window focus: the backend is local, and data changes only through this app and the queue events.

## Fixtures

`createFixtureClient(options)` in `ui/src/api/fixtures/fixture-client.ts` implements the same interface on data in memory. Each client has its own copy.

| Option | Values | |
|---|---|---|
| `scenario` | `default`, `loading`, `empty`, `error` | `loading` never answers, `empty` has no rows and an idle queue, `error` rejects everything with a 500 |
| `board` | `review`, `reviewDone`, `unassigned` | The data of the Editor boards; other boards show the same data in another UI state |
| `noAudio` | `true` | `getAudioUrl` gives null |
| `overrides` | any methods of `ApiClient` | One method behaving differently, such as a failing save on a loaded screen |

The fixtures have the shape of the API and mirror how it reads back: a corrected speaker is in `speaker_resolved` with `speaker_final` null, and an unassigned segment has neither. What the design shows and the API does not have, such as pinned recordings, folders, chapters or a speaker's handle, is not in them. The exception is candidates, which already have the up to three per speaker with percentages the review card shows.

Design review (`DESIGN_REVIEW_ID`) is not on a board: it has four voices with no name, among them one with no candidates, one with no clip and one with a clip of 29 seconds, to go through a whole review.

Audio is made in memory from the segments (`test-audio.ts`): a tone per speaker, in order of appearance, and silence in the pauses, so a jump to the next speaker can be heard. There is no file in the repository and no request, and like all fixtures it is not in a build.

`playEvents(script)` plays queue events on a timer. `EVENT_SCRIPTS` in `event-scripts.ts` has `transcribing`, which ends with a new recording in the list, and `failed`, which leaves the job failed in the queue.

### In Storybook

Each story gets a fixture client, chosen by the `api` parameter:

```tsx
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Done: Story = { parameters: { api: { board: 'reviewDone' } } }
```

To play events, a story takes the client: `useApi() as FixtureClient`. `window.electronAPI` is a mock with settings in memory (`ui/src/platform/electron-api-mock.ts`). The type of the bridge is in `electron-api.ts`, and a build test keeps its keys equal to `electron/preload.js`. Foundations / API fixtures in Storybook shows every scenario and plays the scripts.

### In the app

```bash
VITE_SONORUS_FIXTURES=1 npm run dev:ui
VITE_SONORUS_FIXTURES=1 VITE_SONORUS_FIXTURE_BOARD=longRecording npm run dev:ui  # another set of fixtures, here three hours of transcript
```

This works on the dev server only. A build drops the branch and the fixtures with it, and a build test checks that.
