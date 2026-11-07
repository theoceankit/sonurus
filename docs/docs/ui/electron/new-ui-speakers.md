---
sidebar_position: 12
---

# New UI speakers

The Speakers window of the new UI (`ui/src/screens/Speakers/`): every speaker the app knows, their name, colour and voice, the recordings they talk in, and Delete. The old UI keeps its own Speakers section ([Electron overview](overview.md#speakers-section)); both work on the same routes ([API endpoints](../../api/endpoints.md)).

## Opening

The Speakers button at the right of the titlebar opens `SpeakersDialog`, which `EditorScreen` holds. Each opening starts on the list, on All speakers. It is a large modal laid out as Choose a speaker: the categories in a column at its side and the list or a card next to them, in one height (`--size-speakers-pane`) whatever is shown. The window closes by its close button or Escape. A card's name and colour are saved only with its Save; the list has nothing to save.

## Categories and the list

- **Categories.** All speakers, Recognized (speakers with a name) and Unnamed, each with its count. Unnamed has its own icon, `speaker-unknown`: a speaker with a question mark. Recently added is marked with `markNotImplemented()` until the API knows when a speaker was added.
- **Search.** Matches any part of the name, whatever the case and the spaces around it. A speaker without a name never matches a search (`filterSpeakers()` in `speakers.ts`).
- **Rows.** `Candidate` with the avatar, the name or Unnamed speaker in grey, the number of recordings and the time the speaker talks (`speakerUsage()`). Speakers whose names differ only by case or spaces get a same name badge (`duplicateNameIds()`): names are labels, not identities, so two people may share one.
- **Order.** As `GET /speakers` gives it: named speakers by name, then those without a name, most recently heard first. Speakers that tie, such as two with one name, keep one order, the one heard last first.
- **States.** Loading, a failure with Retry, no speakers at all (they appear after a transcription), no match for the search, and an empty category.
- **New speaker** at the left of the footer is marked with `markNotImplemented()`: a speaker is still made by assigning segments to them in the Editor.

## A speaker's card

A click on a row opens `SpeakerCard` in place of the list; the categories stay, and Back to speakers returns to the list. The card goes from who the speaker is to where they talk: name, handle and colour, then usage, the voice sample and Appears in. More, at the top right, holds Merge and Delete. A speaker that goes while their card is open (deleted, or all data reset) takes the card back to the list.

- **Name.** Edited in place; typing and leaving the field save nothing. Enter is Save, and Escape in the field takes the card's edits back and keeps the window open. A blank name is not saved, so Save stays off with one. A name another speaker has is allowed and said under the field. A refusal of the backend is shown at the field. A saved name shows everywhere: in the list, the sidebar, the transcript and the inspector.
- **Handle** and Merge into another speaker in the More menu are marked with `markNotImplemented()`, for the speaker profiles and merging still to come.
- **Colour.** A speaker with a name chooses one of the five speaker colours, and the avatar shows it before Save. A speaker without a name is grey, and the card says a colour comes with a name. It does not promise that a name makes the speaker recognized: recognition comes from the voice, which only assigning segments in the Editor teaches.
- **Usage.** The recordings, the time the speaker talks and when they were last heard.
- **Voice sample.** The segment `GET /speakers/{id}/sample` picks, at most fifteen seconds, in a `VoiceClip`, the same as the clip of the inspector's Review card: the player, and its text folded under Show text. While the sample loads, Play is off and there is no text yet. When no recording of the speaker has its audio any more, the card says so instead, and a speaker in no recording says Not in any recording yet.
- **Appears in.** The recordings of `GET /speakers/{id}/transcripts`, newest first, as `AppearanceRow`: the title and the date. A click closes the window and opens the recording in the Editor. Play stands over the date on hover and focus and plays a sample of the speaker from that recording. A recording whose file is gone (`has_audio` false) has Play off from the start, with Audio unavailable as its tooltip.
- **Save and Cancel** stand at the right of the footer while a card is open, both off until something is edited. Save sends the name and colour in one `PATCH /speakers/{id}` (`draftChanges()` in `speakers.ts`) and is done once the speakers are read again; Cancel takes the edits back. The edits live in `SpeakersDialog` (`SpeakerDraft`), so they go with the card: Back, a category, closing the window or opening a recording from Appears in first ask Discard changes? (`DiscardChangesDialog`), with Keep editing and Discard. A card without edits leaves at once.
- **Delete speaker** in the More menu, right under Merge, asks first in a danger dialog (`DeleteSpeakerDialog`, focus on Cancel) with the text of `deleteSpeakerPrompt()`: how many segments in how many recordings become Unassigned, and that the voice profile goes. `DELETE /speakers/{id}` then removes the name, colour and voice; the recordings and the speaker list are asked for again, and the next speaker of the list opens, or the one before, or the list. While the queue transcribes or a recording runs it does not ask but shows the reason in a toast (`deleteBlockReason()` on the queue snapshot), as a menu item cannot show a tooltip; the backend refuses then too.

## Samples

`useSamplePlayback()` (`ui/src/media/sample-playback.ts`) plays one sample at a time on an audio element of its own, so the Editor's player keeps its place and pauses while a sample plays, as a clip of the inspector does. A sample may come from any recording: the player loads the recording by its id (`getRecordingAudioUrl()`, `GET /transcripts/{id}/audio`) and plays once it is ready. A second Play pauses it; closing the window or another card stops it.

## Stories

`Screens/Speakers` shows the list in each category and state, the fixtures' two people named Mark Ellis (`board: 'sameNames'`), cards of a named speaker, one with an edited name and colour, the Discard changes question, its voice sample with the text open and while it loads, one without a name, one with a recording whose file is gone (Oliver Grant, Archived partner call), one with no audio at all, one in no recording, the More menu, Delete while the queue transcribes, a refused Delete and the delete prompt. `Screens/Editor` → With Speakers open shows the window over the Editor.
