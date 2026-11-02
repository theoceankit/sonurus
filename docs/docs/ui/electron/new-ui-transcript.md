---
sidebar_position: 6
---

# New UI transcript

The centre panel of the Editor in the new UI: the header of the recording, turns, paragraphs and what happens over them.

```
EditorScreen → TranscriptPanel → TranscriptHeader
     │                         → TranscriptList → TurnHeader, Paragraph
     │                         → SpeakerMenu, the bar over selected text
     └ useTranscriptPlayback() → playback, shared with the player
```

## Turns and paragraphs

`buildTurns()` in `ui/src/screens/Editor/transcript.ts` makes a turn of the neighbouring segments of one speaker, however long the pause between them. Nothing is merged in the data: each segment stays a paragraph, because the API plays, edits and deletes segments. A speaker with no name is `Unknown speaker N`, numbered by first appearance in the recording.

## Long recordings

A recording of three hours is about 3600 paragraphs, so the list renders little and draws less:

- A turn off screen is left out by the browser through `content-visibility: auto`. There is no virtual list, so selecting text works across any number of turns. `--size-turn-estimate` is what a turn counts for until it has been drawn once, and the scrollbar settles as turns get seen.
- A row learns what concerns it from a store (`createKeyStore()`, `useIsKey()` in `ui/src/media/active-segment.ts`). `followActiveSegment()` works out the segment playing once per tick and wakes the rows only when it changes, so a tick inside a segment renders nothing and a change renders two paragraphs. Editing and the open speaker menu work the same way.
- A paragraph makes its bar of actions and its field only while it needs them.
- `sameTurn` compares a turn by its segments. TanStack Query keeps the objects of unchanged segments when new data arrives, so saving one paragraph renders that paragraph, and a refresh that changes nothing, such as a job finishing on another recording, renders none and leaves the scroll and the audio alone.

`VITE_SONORUS_FIXTURES=1 VITE_SONORUS_FIXTURE_BOARD=longRecording npm run dev:ui` opens a long recording on fixtures, and `Screens/Editor/Transcript/Long recording` in Storybook shows it with no sound. On fixtures it opens slowly, because its test audio is made in memory first; the transcript itself takes a fraction of a second.

## Behaviour

- **Changing a speaker.** A click on the name in a turn opens the speaker menu and changes the whole turn. Change speaker under More on a paragraph opens the same menu and changes one segment. Only speakers with a name can be chosen; the list shows the ones of this recording, the longest first, and the search goes over all of them. `useAssignTurnSpeaker()` in `queries.ts` is the one place that knows how several segments change.
- **Editing a paragraph.** The pencil or a double click. Leaving the field and Ctrl+Enter save, Esc cancels, and empty or unchanged text saves nothing. The text shows at once and goes back with an error toast if the request fails.
- **Renaming.** A click on the title. Enter and leaving the field save, Esc cancels. An empty title or one longer than 200 characters is not saved.
- **Deleting the recording.** Delete recording under More in the header, plain or sticky, asks first in `DeleteRecordingDialog`. Once deleted, no recording is open and the sound stops. A failure is a toast and the recording stays open.
- **Selecting text.** A bar stands above the first selected line once the press is over, and never during an edit.
- **Playback.** A click on the time of a turn seeks, and Play on a paragraph seeks and plays. The paragraph playing has a bar in its speaker's colour, from the first time the audio moves. The list does not follow the player.
- **Keyboard.** The list is one stop of Tab, which lands on the row it was last on or the first in view. Up and Down go over names, times and paragraphs; Enter on a paragraph edits it. A focused paragraph shows its bar, and Tab goes on into it.

Pin and Export in the header and Highlight are marked with `markNotImplemented()`. Show all speakers calls `onShowAllSpeakers` with the segments of the turn or paragraph, and `EditorScreen` opens Choose a speaker for them: see [New UI inspector](new-ui-inspector.md).
