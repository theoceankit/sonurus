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

`getAudioUrl` is what an audio element plays for a recording, or null when there is nothing to play. On the backend it is `GET /transcripts/{id}/audio`, which answers Range requests. A page on the dev server may not open `file://`, so the route gives both ways of running the app the same source, and the CSP of the new UI allows `http://localhost:8000` for media instead of `file:`.

`getWaveform(transcriptId, { bars, start, end })` gives one height from 0 to 1 per bar over a stretch of a recording, on the scale of the whole recording: `GET /transcripts/{id}/waveform`. `useWaveform()` asks for nothing with no recording or no length yet and never asks for the same stretch twice; its key is not under the transcript's, since an edit never changes the audio. The fixtures make levels from the segments: loud where someone speaks, quiet in the pauses.

`getSpeakerCandidates` gives, per unrecognized speaker, up to three candidates and a clip of the voice, as `GET /transcripts/{id}/speaker-candidates` answers. A speaker with no candidates is still in the answer, for its clip. The fixtures also give candidates to recognized speakers for the Possible match state in Storybook; the API does not.

`assignSpeaker({ transcriptId, segmentStarts, target })` gives segments a speaker in one request, all or none, and answers `{ speakerId }`, so the id of a new speaker comes from the backend.

`undoSpeakerAssignment({ transcriptId, segmentStarts, speakerId, createdSpeakerId })` puts segments back under the speaker they had before an assignment. `createdSpeakerId` names a speaker the assignment made, who goes with nothing left. See `POST /transcripts/{id}/speaker-assignments/undo` in the [API](../../api/endpoints.md).

`markTranscriptOpened(id)` tells the backend the user has opened a recording, so it is no longer new in the sidebar (`opened` in the list). Loading it with `getTranscript` does not.

`addQueueJob({ audioPath, whisperModel, language, title })` puts a file into the transcription queue: `POST /queue/jobs`. The backend copies the file into `recordings/` and answers the waiting job; with no title it is named after the file. A null model or language is the backend's own: its default model, and the language detected from the audio. A model the job needs that is not installed, or a file it cannot read, is a 400 whose message says what is wrong; for a missing model it ends with "Download it in Settings.".

`listModels()` is `GET /models`: every model of the catalog with `installed`. Whisper and diarization rows carry a name, size, speed and accuracy; alignment rows only `id`, `kind` and `installed`, and the new UI names them itself ([New UI transcription](new-ui-transcribe.md#models)).

`startModelDownload(id, hfToken)` starts downloading a model, or joins its running download, and answers the job id; `cancelModelDownload(id, jobId)` stops it; `watchModelDownload(jobId, listener)` follows `WS /ws/models/{job_id}` until the download ends with `done`, `cancelled` or `error`. That socket is not in the OpenAPI schema, so its events are typed in `model-download-events.ts`; a connection that drops before the end counts as an error. Screens use them through `useModelDownloads()` ([New UI transcription](new-ui-transcribe.md#downloads)).

`updateQueueJob(jobId, update)` changes the title, model or language of a job that is not running: `PATCH /queue/jobs/{id}` with only the fields given. A model or alignment model that is not installed is a 400, a running job a 409. The fixtures do the same.

`resetData()` deletes every transcript, speaker and recording: `POST /data/reset`, answered with how many of each went. A running transcription or recording is a 409. The fixtures empty their data and refuse while a job runs.

`getGpuStatus()`, `startGpuDownload()`, `cancelGpuDownload(jobId)`, `watchGpuDownload(jobId, listener)`, `removeGpuPack()` and `requestGpuRestart()` are `GET /gpu`, `POST /gpu/download`, `DELETE /gpu/download/{job_id}`, `WS /ws/gpu/{job_id}`, `DELETE /gpu/pack` and `POST /gpu/restart`; the events of the socket and the answer of the restart are typed in `ui/src/api/gpu-events.ts`, as they are not in the schema. The fixtures start from `FIXTURE_GPU`, a packaged Linux app on an RTX 4060 with nothing downloaded, changed with the `gpu` option; their download goes as a model download does, waits for the restart, and the restart the app is allowed applies it.

`deleteModel(modelId)` deletes a downloaded model: `DELETE /models/{id}`. A model the running transcription needs is a 409, one that is not downloaded a 404. The fixtures do the same.

`setQueueStartMode(startMode)` sets whether new jobs start on their own (`auto`) or wait for Start (`manual`): `PUT /queue/settings`, answered with the new snapshot. `useSetQueueStartMode()` puts that snapshot in the cache at once. The fixtures do the same and send the snapshot to the queue's listeners.

`retryQueueJob(jobId)` puts a failed job back at the end of the queue, waiting and with no error: `POST /queue/jobs/{id}/retry`. A model it needs that is still not installed is a 400, a job that has not failed a 409. The fixtures do the same.

`startQueue()` and `pauseQueue()` are `POST /queue/start` and `POST /queue/pause`; `reorderQueue(jobIds)` is `PUT /queue/order` with every job of the queue exactly once, else a 400. All three answer the queue after the change. A pause stops the running job at once, and it waits again at its place. `deleteQueueJob(jobId)` is `DELETE /queue/jobs/{id}`: it takes the job and its copy of the audio away, stopping it first if it runs; an unknown job is a 404. The fixtures do the same and send each change as a snapshot.

`now()` is today for the screens: the current time on the backend client, 5 October 2026 on fixtures, so that sections of the recordings list stay as on the design boards.

A speaker's `color_index` counts from 0. `speakerColor()` in `ui/src/styles/speaker-colors.ts` turns it into a colour of the avatars. The fixtures use the colours of the boards.

## Queue events

`subscribeQueueEvents` gives the current snapshot and then every snapshot and job event. `queue-events.ts` connects to `WS /ws/queue`, reconnects two seconds after the connection drops and does not pass heartbeats on.

`useQueueEventsSync()`, called once at the root of the app, puts snapshots into the cache behind `useQueue()` and refreshes the recordings and speakers on `job_done`. Its optional callback is for what the app shows itself: the toasts of finished and failed jobs and the Alignment model dialog ([New UI transcription](new-ui-transcribe.md#finished-and-failed-jobs)).

## Connection to the backend

The WebSocket is also how the app knows the backend is there. `useBackendConnected()` is false from the moment the connection drops until it opens again, and a first attempt that fails counts as a drop.

- While it is down, `App` shows a toast that stays. What is on the screen stays too, and an action fails with its own toast.
- When it is back, every query is refreshed, as a job may have finished unheard. That also clears the error of a first load, with no click on Retry.
- A load of audio that failed is tried again from the same position (`Playback.reload()`). While the backend is down the player does not call the file missing.

Reading a query, screens show an error only when there is no data: a refresh that fails leaves what was loaded.

## Hooks

`queries.ts` has one hook per read and per change. A change refreshes what it affects. Queries do not retry and do not refetch on window focus: the backend is local, and data changes only through this app and the queue events.

`useMarkOpened(id, loaded)` is called by `TranscriptPanel`. Once the recording has loaded and the list says it is not opened, it sets `opened` in the list at once and calls `markTranscriptOpened`, then refreshes the list only, not the recording. A failure says nothing: the next list brings the dot back. It asks once per opening, because after a failure the list says not opened again and it would ask forever.

`useModels()` reads the catalog and asks again every time a screen that uses it mounts, as models are downloaded and deleted elsewhere (the old UI, and later Settings).

`useAddToQueue()` takes files with their titles, one model and one language, and puts the files into the queue one at a time, in the order given. A null title is the file name, and a null model or language is the backend's own. It stops at the first refusal with an `AddToQueueError`, whose `added` says how many files went in before it, so that the caller does not send them twice. The model and language come from the caller: the import dialog works them out from the settings ([New UI transcription](new-ui-transcribe.md)), and `readTranscribeSettings()` in `ui/src/platform/transcribe-defaults.ts` reads what the settings keep.

`useQueueControl()` (start or pause) and `useReorderQueue()` put the queue they answer into the cache at once, before its snapshot arrives on the socket. `useRetryQueueJob()` and `useDeleteQueueJob()` ask for the queue again.

`useDeleteTranscript()` counts a recording already gone as deleted. It takes the recording off the list at once and does not ask for its details again, as the panels still show it until `EditorScreen` closes it.

## Fixtures

`createFixtureClient(options)` in `ui/src/api/fixtures/fixture-client.ts` implements the same interface on data in memory. Each client has its own copy.

| Option | Values | |
|---|---|---|
| `scenario` | `default`, `loading`, `empty`, `error` | `loading` never answers, `empty` has no rows and an idle queue, `error` rejects everything with a 500 |
| `board` | `review`, `reviewDone`, `unassigned` | The data of the Editor boards; other boards show the same data in another UI state |
| `noAudio` | `true` | `getAudioUrl` gives null and `getWaveform` a 404 |
| `noModels` | `true` | Nothing is downloaded: `listModels` has every model uninstalled, and `addQueueJob` answers the 400 of a missing diarization model (`NO_MODELS`) |
| `installedModels` | model ids | What is downloaded, in place of `DEFAULT_INSTALLED` (`small`, `large-v3`, `diarize`; no alignment model) |
| `downloadStepMs` | milliseconds | A model download goes up a quarter every step, then installs the model; 400 by default |
| `downloadFails` | `true` | A model download ends with an error at 100 % and installs nothing |
| `overrides` | any methods of `ApiClient` | One method behaving differently, such as a failing save on a loaded screen |

`addQueueJob` on fixtures refuses a job as the backend does, in its order: a Whisper model that is not downloaded, then the diarization model, then the alignment model of the language, each with the backend's message.

`setConnected(false)` on a fixture client loses the connection to the backend, and `setConnected(true)` brings it back.

The fixtures have the shape of the API and mirror how it reads back: a corrected speaker is in `speaker_resolved` with `speaker_final` null, and an unassigned segment has neither. What the design shows and the API does not have, such as pinned recordings, folders, chapters or a speaker's handle, is not in them. The exception is candidates, which already have the up to three per speaker with percentages the review card shows.

Design review and Interview: onboarding feedback are not opened yet, as is the recording `transcribing` adds; the others are.

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
