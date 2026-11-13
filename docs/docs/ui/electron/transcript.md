---
sidebar_position: 6
---

# Transcript

The centre panel of the Editor in the UI: the header of the recording, turns, paragraphs and what happens over them.

```
EditorScreen → TranscriptPanel → TranscriptHeader
     │                         → TranscriptList → TurnHeader, Paragraph
     │                         → SpeakerMenu, the bar over selected text
     └ useTranscriptPlayback() → playback, shared with the player
```

## Turns and paragraphs

`buildTurns()` in `ui/src/screens/Editor/transcript.ts` makes a turn of the neighbouring segments of one speaker, however long the pause between them. Nothing is merged in the data: each segment stays a paragraph, because the API plays, edits and deletes segments. A speaker with no name is `Unknown speaker N`, numbered by first appearance in the recording.

The paragraphs of a turn follow each other with no space between them, so a turn reads as one block, and turns are 12 px apart. The bar of a paragraph's actions is a little taller than a line and sits centred on the first one.

## Long recordings

A recording of three hours is about 3600 paragraphs, so the list renders little and draws less:

- A turn off screen is left out by the browser through `content-visibility: auto`. There is no virtual list, so selecting text works across any number of turns. `--size-turn-estimate` is what a turn counts for until it has been drawn once, and the scrollbar settles as turns get seen.
- A row learns what concerns it from a store (`createKeyStore()`, `useIsKey()` in `ui/src/media/active-segment.ts`). `followActiveSegment()` works out the segment playing once per tick and wakes the rows only when it changes, so a tick inside a segment renders nothing and a change renders two paragraphs. Editing and the open speaker menu work the same way.
- A paragraph makes its bar of actions and its field only while it needs them.
- A speaker highlighted in the inspector renders no row. A turn carries its speaker in `data-speaker`, and one listener in `TranscriptList` sets `data-highlighted` on that speaker's turns and takes it off the others; a speaker of a long recording may have a thousand turns. Nothing is measured. The tone sits on an element inside the turn, so a turn left out off screen works out no colour and runs no transition.
- `sameTurn` compares a turn by its segments. TanStack Query keeps the objects of unchanged segments when new data arrives, so saving one paragraph renders that paragraph, and a refresh that changes nothing, such as a job finishing on another recording, renders none and leaves the scroll and the audio alone.

`VITE_SONORUS_FIXTURES=1 VITE_SONORUS_FIXTURE_BOARD=longRecording npm run dev:ui` opens a long recording on fixtures, and `Screens/Editor/Transcript/Long recording` in Storybook shows it with no sound. On fixtures it opens slowly, because its test audio is made in memory first; the transcript itself takes a fraction of a second.

## Behaviour

- **Changing a speaker.** The avatar and the name of a turn are one button: a click on either opens the speaker menu under it and changes the whole turn. The time stands 8 px after the name and nothing appears between them, so it never moves; a long name ends in an ellipsis before it. Change speaker under More on a paragraph opens the same menu and changes one segment. Only speakers with a name can be chosen; the list shows the ones of this recording, the longest first, and the search goes over all of them. A change is one request, and shows a toast with Undo (`useSpeakerChange`). Changing one paragraph makes a turn of its own, so the rows below it move.
- **Editing a paragraph.** The pencil or a double click. Leaving the field and Ctrl+Enter save, Esc cancels, and empty or unchanged text saves nothing. The text shows at once and goes back with an error toast if the request fails.
- **Renaming.** A click on the title. Enter and leaving the field save, Esc cancels. An empty title or one longer than 200 characters is not saved. The field is `TitleField`, also used by Rename in the [menu of a recording](overview.md#menu-of-a-recording) in the sidebar.
- **Deleting the recording.** Delete recording under More in the header, plain or sticky, asks first in `DeleteRecordingDialog`. Once deleted, the sound stops and the recording opened before it opens ([Home](home.md#which-recording-is-open)). A failure is a toast and the recording stays open. The menu of the recording in the sidebar has it too.
- **Selecting text.** A bar stands above the first selected line once the press is over, and never during an edit.
- **Staying in place.** A change of speaker can bring a turn header above a paragraph or take one away. The list scrolls by the same amount, so the paragraph whose menu was opened stays where it was on the screen, also after Undo (`useKeepRowInPlace`). Near the very top nothing can scroll, and a row out of sight is left alone.
- **Copying.** Copy on a paragraph, on the bar and Copy transcript in the header writes through `electronAPI.writeClipboard`: the main process allows only the microphone, so `navigator.clipboard` is refused. Copied says it worked. Copy transcript, between Pin and Export in the plain and the sticky header, copies the title and every turn as the Editor shows it: the title, then for each turn the speaker and the turn's start time on one line and a line per paragraph under it, an empty line between blocks (`transcriptText`). With no speech in the recording it is disabled.
- **Deleting a paragraph.** Delete under More acts at once, with no confirmation and no Undo.
- **Playback.** A click on the time of a turn seeks, and Play on a paragraph seeks and plays. The paragraph playing has a bar in its speaker's colour, from the first time the audio moves. The bar fills from top to bottom over a dim track as the segment plays: `usePlayingBar()` in `ui/src/media/playing-bar.ts` runs it on Web Animations for the one row playing, because the audio tells the time only about four times a second, and corrects it on a seek, a pause, another speed or a drift over 250 ms. With reduced motion it stands whole. The list does not follow the player.
- **Keyboard.** The list is one stop of Tab, which lands on the row it was last on or the first in view. Up and Down go over names, times and paragraphs; Enter on a paragraph edits it. A focused paragraph shows its bar, and Tab goes on into it. Space plays and pauses from where the audio is, not from the paragraph in focus ([Player → Space](player.md#space)).

The folder over the title, Pin and Export in the header and Highlight on the bar of a text selection are marked with `markNotImplemented()`. The buttons of a paragraph's bar and of the header name themselves in tooltips; the header's share one (`TooltipGroup`), and a disabled Copy transcript has none. Show all speakers calls `onShowAllSpeakers` with the segments of the turn or paragraph, and `EditorScreen` opens Choose a speaker for them: see [Inspector](inspector.md).
