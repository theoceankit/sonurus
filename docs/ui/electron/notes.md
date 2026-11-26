---
sidebar_position: 13
---

# Notes

The note of a recording (meeting minutes): one per recording, in basic Markdown that renders as it is typed, kept on the backend and saved as it is typed. How it is stored is in [Data Models → Note](../../data-models.md#note), its routes in [API endpoints](../../api/endpoints.md#get-transcriptsidnote).

```
EditorScreen → useNotesSaver (note-autosave.ts, note-merge.ts) ← WS /ws/events
     ├ InspectorPanel → Inspector → Notes tab → EditorNotes → NotesPanel → NoteFormatBar, NoteEditor (Tiptap) → MentionList
     └ centre, expanded → EditorNotes
```

## Where

The Notes tab of the [Inspector](inspector.md), next to Speakers. Every recording opens on Speakers, also after another one was on Notes. A recording without a note opens an empty editor with the hint "Write notes"; an empty note is no note, and nothing is stored for it.

Expand notes, in the row of the tabs next to Close inspector, puts the note in place of the transcript, with the title of the recording over it; the player stays and plays. The right panel goes back to Speakers, and its Notes tab says the note is open in place of the transcript, with Collapse notes. The button over the note, Collapse notes in the tab, or Escape puts the transcript back, and the Notes tab with it. Escape collapses wherever the focus is, in the note too, unless a menu, a list or a window is open, which takes it first; the next Escape closes the recording as usual. Another recording opens with its transcript.

While the note is in the tab, Escape in it does nothing: it is a text field, and the recording stays open (`escape-close.ts`).

## The editor

`NoteEditor` is [Tiptap](https://tiptap.dev) 3 (ProseMirror), headless and drawn with the tokens only. Markdown typed turns into what it means at once, as in Typora: `#`, `##` and `###` and a space for headings, `-` or `*` for a list, `1.` for a numbered one, `- [ ]` or `[ ]` for a checkbox (`[x]` for a ticked one); `[ ]` at the start of a list item makes that item a checkbox, the list splitting around it and the checkbox joining any right before it, `>` for a quote, `**bold**`, `*italic*`, `[text](address)` for a link; Ctrl+B and Ctrl+I (⌘ on macOS) too. No tables, images or code. A ticked checkbox turns grey, not struck through. Undo and Redo (Ctrl+Z, Ctrl+Shift+Z) are the editor's own: they reach back to when the note opened in the tab or expanded, not across them.

A plain click on a link only puts the cursor in it; Ctrl+click (⌘ on macOS) hands it to the system browser or mail app through `openLink()` of the preload. Only `http`, `https` and `mailto` addresses open (`electron/links.js`); the window itself never follows a link.

The editor is a third of the UI's code, so it is a chunk of its own (`React.lazy` in `EditorNotes.tsx`), loaded the first time a note opens.

## The format bar

`NoteFormatBar` is a row right over the text of the note, in the tab and expanded; it does not scroll with the text and fits a tab 300 wide. From the left: the text style menu (Plain text, Heading 1 to 3), Bold, Italic, Bulleted list, Numbered list, Checkbox, Quote, Link, and the player's time. Each has a tooltip with its name.

A button is highlighted when its format holds at the cursor, and a second press takes the format off. One that cannot apply there is out of use; in the style menu the style the text has is checked and never out of use. Bold and Italic work on the selection, or without one on what is typed next. The styles, lists and Quote work on the block with the cursor or on all those selected, and on nothing around them (`note-blocks.ts`):

- The item of a line is the one whose bullet, number or checkbox it has, and only that list is lit. A block further down in an item is no item itself: a list button makes it one, inside.
- An item changed to another type keeps its place in a list around it or in a quote, the items under it and, if it is a checkbox already, its tick. Its list splits around it, and it joins a list of that type right next to it.
- An item taken off becomes a paragraph where it stood, and what was under it follows it.
- A paragraph in a quote becomes a list in the quote. Quote takes a list only when all of it is selected; of a list in a quote, the items selected leave it.
- Empty paragraphs at the ends of a selection, such as the one at the end of the note, do not count.

A press does not take the focus from the note, and the menu and the link window give it back, unless they were closed by going elsewhere: to a click or a field outside the note, or from one of them to the other. Each use is one step of Undo, also right after typing (`note-format.ts`). The bar reads the editor through `useEditorState`, so it renders with the cursor and `NoteEditor` does not.

Link opens a small window with the address (`NoteLinkPopover`). With a selection the selected text becomes the link; without one the address goes in as the link's text, an email address without its `mailto:`. With the cursor on a link the window shows its address, to change it or remove the link. Enter or Apply applies, Escape closes the window and leaves the note expanded. What is selected stays visible while the window or the text style menu is open (`KeptSelection`), not whenever the note is without the focus. `parseNoteLink()` in `note-link.ts` accepts `http`, `https` and `mailto`, adds `https://` to a host with no scheme, such as `example.com`, and `mailto:` to an email address; anything else gets an error under the field.

## Timecodes

A moment of the recording is a chip in the note, "12:34", one node the cursor goes around (`timecode` in `note-extensions.tsx`). A click on it takes the player there (`playback.seek`); the player and the transcript follow as with any seek. The time is kept in whole seconds. A time typed as text stays text.

The clock button at the end of the format bar inserts where the player stands, to the second, as a chip. It goes where the cursor was last in the note, or at the end if the cursor has not been in it since it opened, and the focus goes there, to type on after it. While the player has no audio (loading, or the file gone) the button is there but out of use. `NoteEditor` and `NoteFormatBar` are memoized, and what they are given stays the same from one second to the next. There is no keyboard shortcut for it.

## Quotes from the transcript

Quote, on the bar over text selected in the transcript, puts the selection into the note as quotes, one for each turn it touches (`selectionQuotes()` in `quotes.ts`): a quote block opening with the speaker and the start of the first paragraph selected in that turn, as chips, and the words selected under them. They go where the cursor was last in the note, or at the end, as the time does, with an empty paragraph after them, and the selection in the transcript clears.

`EditorScreen` keeps the quotes as a request for the recording, opens the Notes tab, and shows the right panel if it was closed or gave way to the sidebar in a narrow window. The tab takes them once its editor is there, after the note and the editor's chunk have loaded (`quotes` and `onQuoted` of `EditorNotes`), each request once. They go in through the editor, as typing does: the note saves itself, a recording without a note gets one, and Undo takes them back.

A quote from a recording without speakers opens with the time alone. The speaker of any other quote is a mention by id, with the label the transcript shows. A named speaker is a chip with the avatar and the name as they are now. A speaker with no name yet is a chip of the same shape with the label, "Unknown speaker 1", and the question mark of Unnamed in the [Speakers window](speakers.md) in place of the avatar; once named, it is the chip with the avatar and the name at once. Unassigned and a deleted speaker, no one to name, read as the label as text.

## Mentions

@ in the note opens a list under it (`MentionList`, its order in `mention-list.ts`): the speakers of this recording first, as they first speak in it, then the other speakers of the base as the speaker list has them (`mentionCandidates()` in `note-speakers.ts`). Only named speakers are there. What is typed after the @, spaces included, narrows both by name and handle, a leading @ left out. With something typed, the last row is Mention "…", for someone not in the base, such as a colleague from a chat. The arrow keys move through the list, Enter or Tab takes the highlighted row (the first speaker of the recording at first), and when no speaker is found the only row left, Mention "…", is the one Enter takes. Escape closes the list and leaves the text as typed. The focus stays in the note.

A speaker becomes a chip with the avatar, in two letters, and the name, kept by id (`mention` in `note-extensions.tsx`): a new name, handle or photo shows at once, in every note. A mention of a voice with no name yet, which a quote or an agent writes, is the unnamed chip until the voice is named (`speakerFinder()` in `note-speakers.ts` tells the two apart). A person not in the base is a chip with "@" and the name, kept as text; it is never linked to a speaker, even one of the same name. There is no way to create a speaker from @.

A speaker merged into another or deleted (in the [Speakers window](speakers.md)) is rewritten in every note by the backend: the mentions follow the speaker merged into; a deleted speaker becomes plain text, the name they had. A note open in the editor keeps its own document and would save the old one over the backend's, so it rewrites itself too (the backend's rewrite changes no version, so it is not heard as a change from elsewhere): `useMergeSpeaker` and `useDeleteSpeaker` rewrite the notes in the cache and tell the open editor (`announceMentionChange()` in `api/note-mentions.ts`, `rewriteMentions()` in `note-content.ts`), which changes its mentions in one step that Undo leaves out, and saves.

## Saving

There is no Save. `useNotesSaver()` in `EditorScreen` holds one saver for the screen (`createNoteAutosave()` in `note-autosave.ts`):

- About a second after typing stops (`NOTE_SAVE_DELAY_MS`), the note is saved with `PUT /transcripts/{id}/note`; an empty one is deleted with `DELETE`. A note the same as the one the backend has is not written: the editor does not save back a version that came from elsewhere.
- At once when the recording shown changes (another one, a job, or none), when the screen goes, and before the window closes or the app quits.
- One request at a time, with the newest text only: a change made during a save goes after it.
- Each write sends the version the note was at when the editor took it, and writes as the editor (`writer` `editor`); a note changed since is refused with `409` and merged, below.
- A save that fails says so once, "Failed to save notes: …", until one succeeds. The text stays in the editor and is tried again with the next change and at each of the moments above. A recording deleted meanwhile is no failure: its note went with it.

Every change is also kept in the query cache of the note at once (`useKeepNote()`), which is never loaded again over it while the app runs, also when the backend comes back ([Data](data.md#connection-to-the-backend)), so the note moving between the tab and the centre, or the recording opened again, shows what was typed, saved or not.

Closing the window to the tray destroys it and quitting gives the page no unload, so before either the main process asks the page to finish (`askWindowToFinish()` in `electron/window-closing.js`, the `window-closing` message) and waits for its answer, up to 1.5 s; the page runs what `onBeforeClose()` registered (`ui/src/platform/before-close.ts`), the saver among them. A reload or a page left in the browser runs them on `pagehide`, without waiting.

## Changes from elsewhere

A note may change while it is open: an agent writes it through [MCP](../../api/mcp.md), or anything else through the API. The backend announces every write over `WS /ws/events` (`note_changed`, [API](../../api/endpoints.md#ws-wsevents)), and the saver, which also listens there, keeps the open note up with it:

- For each note the editor opened, it keeps the version and document the backend had (`loaded()` from `EditorNotes`, then each of its own writes). An event with that version is its own write and is let go.
- Any other version is read (`GET`) and merged with what the editor has (`mergeNotes()` in `note-merge.ts`), in the saver's line of requests. The merge is taken at the moment the answer comes, so what was typed during the request is in it. A save refused with `409` does the same and saves the result.
- The merge goes block by block from the version both sides started from, inside lists and quotes: what only one side changed is taken from it, the same change once, a block one side removed and the other changed stays changed. A block both sides changed differently is kept in both versions, theirs first, and the toast "Notes changed elsewhere while you typed: both versions of a paragraph are kept" says so once. A list item in two versions is two items.
- With nothing typed, the note just takes the new version, without a toast. A note deleted elsewhere empties an editor with nothing typed; what was typed stays and is saved as a new note.
- The open editor gets the result through `onNoteFromElsewhere()` (`api/note-elsewhere.ts`) and replaces only the stretch that differs (`replaceChanged()` in `NoteEditor.tsx`), in one step Undo leaves out: Ctrl+Z takes back only what was typed here. The cursor outside that stretch stays where it was, one inside it goes to its end. The step is marked `external` with who wrote it (`{ writer }`), for anything that will show changes from elsewhere; nothing does yet.
- A note the saver does not keep (a recording not opened in the editor) leaves the cache and is read again when it opens. `has_note` of the list follows every event.
- Each time the socket says `connected`, also after the backend comes back, every note the saver keeps is read again: what changed while away was not heard.

A speaker merged or deleted rewrites the mentions in the notes on the backend without a new version ([Mentions](#mentions)); the saver rewrites them in the versions it keeps too, so they do not count as a change.

## Copy notes

Copy notes, next to Expand notes (in the header of the note when it is expanded), puts the note on the clipboard as Markdown (`note-markdown.ts`): headings `#`, lists `-` and `1.`, checkboxes `- [ ]` and `- [x]`, quotes `>`, `**bold**`, `*italic*`, `[text](address)`, a timecode as `[12:34]` (`[1:02:03]` from an hour on), a speaker as "Name (@handle)", a person as "@Name"; empty paragraphs are left out. Text copied from the note with Ctrl+C has a timecode in the same form. It is off while the note is empty. Like Copy transcript, it writes through `electronAPI.writeClipboard` (`copyToClipboard` in `clipboard.ts`): Copied says it worked, Copy failed that the clipboard refused it.

## The schema on the backend

The backend reads and writes notes as Markdown too, in a form of its own that reads back without loss ([Note Markdown](../../services/NoteMarkdown.md)), so it has to know the editor's nodes and attributes. The documents in `tests/fixtures/notes/` are what this editor saves: `note-fixtures.test.tsx` loads each into `NoteEditor` and expects the same document back. A change to the nodes, marks or attributes of the note (`NoteEditor.tsx`, `note-extensions.tsx`) fails that test; the fixtures are rewritten from the editor with `NOTE_FIXTURES=write` and `app/services/note_markdown.py` follows in the same change.

## Deleting

A note goes with its recording: Delete recording and Delete all data remove it on the backend. The delete dialog of a recording with a note says so: "The transcript, its notes and its recording made in Sonorus will be deleted." (`has_note` of `GET /transcripts`).

## Stories

Screens / Editor / Notes shows the notes as the app has them on fixtures (the weekly sync has a note): Closed, Notes Tab Empty, Notes Tab With Text, Notes Expanded, Save Failed (every save refused, typing says so), Narrow Window, Quote To Notes (two turns selected), Quote Inserted (their quotes in the opened tab) and Quote Into Empty Note. Notes With Mentions, Mention List Open, Mention Someone Else and Copy Notes have a note with every chip: speakers of the recording and others, a person not in the base and a deleted speaker. Components / NoteEditor, NoteFormatBar, NoteLinkPopover, NotesPanel, MentionList and MentionChip have a story for each of their states, NotesPanel's No Audio the time button out of use.
