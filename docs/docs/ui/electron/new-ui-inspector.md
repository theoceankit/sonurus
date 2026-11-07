---
sidebar_position: 7
---

# New UI inspector

The right panel of the Editor in the new UI: who speaks and for how long, and the review of speakers with no name.

```
EditorScreen → InspectorPanel → Inspector → TalkTime, SpeakerRow
     │              │                     → ReviewCard → ClipPlayer, Candidate
     │              └ review-queue.ts, inspector.ts, clip-playback.ts
     └ SpeakerDialogs → ChooseSpeakerModal, NewSpeakerModal (speaker-search.ts, new-speaker.ts)
```

The components only draw and report. `InspectorPanel` holds the data and the state of the review, and resets it with another recording: Skip and Close are not saved anywhere.

## Speakers

Rows go by talk time, with Unassigned last, as it is not one person. Talk time is the sum of a speaker's segments.

How many rows show depends on the room between talk time and the review dock, with the review open, collapsed or over. When everyone fits, everyone shows. Otherwise the panel shows as many as fit, and the last place goes to Show N more for the rest. At most eight rows show however much room there is, so nine speakers make eight rows and Show 1 more. One speaker always shows, however little room: below that the whole panel scrolls (see the review). The current speaker of an open review is always in sight, in their own place or in the last one. The rows shown stay in their places when the rest open under them.

The room is measured on a box that takes it whatever is in it (`useRowSlots()` in `InspectorPanel`), so what shows never changes what is measured, and `splitRows()` in `inspector.ts` works out the rows from it. Rows are 28 px with 2 px between them (`--size-control-md`, `--space-half`). The first measure comes before the first paint, so nothing folds when a recording opens. After that, a row that no longer fits folds away and one that fits again opens, as `Reveal` does: when the window is resized, when the dock comes or goes, and when the card grows with the text of its clip. A list opened by hand with Show N more closes again when the number of rows that fit changes.

On hover and focus a row has two buttons in place of the time: Play for the speaker's first segment, and Assign, which opens Choose a speaker for all of the speaker's segments in this recording. Unassigned has only Assign. A click on a speaker who is under review opens the card on them.

### Highlighting a speaker

A row under the pointer or with the focus in it highlights its speaker, and so does a segment of talk time, which also names the speaker and their time in a tooltip.

The pointer has to stay on a row or a segment for 150 ms (`--delay-hover`) before its speaker lights up, so a pointer crossing the panel on its way to the buttons above highlights nobody. While a speaker is lit, and for 300 ms after (`--delay-hover-skip`), the next row or segment lights up at once, as tooltips do. The focus lights up at once, and leaving takes the highlight away at once. A row takes the pointer over the 2 px gap under it, as a segment of talk time does over the gaps beside it, so a pointer moving from one speaker to the next never falls between two and the highlight does not go out on the way. A speaker row looks hovered and shows its Play and Assign buttons with the highlight, not with the pointer alone, so the buttons wait as well; the focus shows them at once. `createHoverIntent()` in `hover-intent.ts` keeps the wait, outside React, and sets the same store. The tooltips of talk time keep their own delay. The speaker's turns in the transcript take their tone and only their bars in the player keep a colour (see [New UI transcript](new-ui-transcript.md) and [New UI player](new-ui-player.md)). Here their segment of talk time keeps its colour while the others fade, and their row looks hovered without its buttons. A speaker behind Show N more lights up Show N more, which stays closed. Nothing scrolls, and the review card plays no part: the speaker under review is not highlighted for being so.

`EditorScreen` holds the speaker in one store (`createKeyStore()`) and hands it to the three panels; the screen itself does not listen. A row that goes away under the pointer reports no leaving, so the highlight is cleared when its speaker is gone, when Show N more opens or closes, when the number of rows that fit changes, when the review opens or closes, when the panel closes and with another recording.

## The review

Who needs a review comes from the segments each time, so an assignment, an undo or a change in the transcript all move the card the same way (`review-queue.ts`):

- The queue is the speakers with no name, in the order they first speak. Unassigned is not in it, because its segments may be several voices.
- `1 of 4` is the place among all at opening; `4 left` is how many have no name yet.
- Skip goes to the next, and around after the last.
- Close collapses the card to one line, and Resume opens it on the next speaker.
- With nobody left, the dock is gone and the unknown avatar leaves the recording's row in the sidebar. Nothing is saved about this: it comes from the segments too.

The card lists the candidates and, last, More speakers, which opens Choose a speaker with the card's choice selected. A new speaker is made from there; the card has no search of its own.

Assign is off until a candidate is chosen, as it writes to speaker memory. It covers all the segments of the voice and shows a toast with Undo, as every change of a speaker does (`useSpeakerChange`): see `undoSpeakerAssignment` in [New UI data](new-ui-data.md). Undo of a speaker the assignment created removes them if nothing else is theirs. The candidate mark and the percentage are what the API says; the client compares nothing with a threshold.

A clip plays from its start to its end on its own audio element (`clip-playback.ts`), so the main player keeps its place. Starting one pauses the other. Another card, another recording or closing the panel stops the clip. With no clip the card has no player, and with no audio its Play button is off.

Show text opens the clip's text inside the card. It takes at most six lines and scrolls beyond them, so the speakers above stay readable. When the card grows, the rows give way to it first, down to one speaker and Show N more. Then the text gets less room, and Skip and Assign stay where they are. In a window lower than about 740 px there is no room for that either, so the whole panel scrolls.

Possible match is a recognized speaker to confirm. The backend does not keep a confidence yet, so only stories show it, through the `possibleMatches` prop.

## Speaker windows

`SpeakerDialogs` lives in `EditorScreen`, because the card, a row and a turn in the transcript all ask who a speaker is, each with its own `onAssign`.

Choose a speaker has categories on the left and the search on the right, with the suggested candidate or the card's choice selected. Arrow keys move the selection and Enter assigns. A search looks at any part of a name. With no results it offers a new speaker with that name. Invited to this meeting and Recently added are marked with `markNotImplemented()`: the API knows neither who was invited nor when a speaker was created.

New speaker takes the name from the search. Its colour starts as the least used and gray is not offered, as it stands for an unknown speaker and the API keeps five colours. Names need not be unique, so a repeated one only gets a note. Back returns to where the window was opened from. The avatar stands on the left of a single column: Name, Handle and Colour. Handle is marked with `markNotImplemented()`.

## Stories

Screens / Editor / Inspector has a story for each board, with the name of the board, and Whole Review for going through every case on Design review. Screens / Editor / Inspector / Room for the rows shows the panel at several heights with 2, 6 and 15 speakers, a long clip and a review over; Fifteen Speakers there is the whole Editor in a frame to resize by its corner.

A row's buttons on hover are not on the boards: they keep what the old panel could do.
