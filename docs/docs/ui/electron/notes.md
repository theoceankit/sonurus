---
sidebar_position: 13
---

# Notes

The note of a recording (meeting minutes): one per recording, in basic Markdown that renders as it is typed, kept on the backend and saved as it is typed. How it is stored is in [Data Models → Note](../../data-models.md#note), its routes in [API endpoints](../../api/endpoints.md#get-transcriptsidnote).

```
EditorScreen → useNotesSaver (note-autosave.ts)
     ├ InspectorPanel → Inspector → Notes tab → EditorNotes → NotesPanel → NoteEditor (Tiptap)
     └ centre, expanded → EditorNotes
```

## Where

The Notes tab of the [Inspector](inspector.md), next to Speakers. Every recording opens on Speakers, also after another one was on Notes. A recording without a note opens an empty editor with a hint of what Markdown does; an empty note is no note, and nothing is stored for it.

Expand notes, in the header of the tab, puts the note in place of the transcript, with the title of the recording over it; the player stays and plays. The right panel goes back to Speakers, and its Notes tab says the note is open in place of the transcript, with Collapse notes. The button over the note, Collapse notes in the tab, or Escape puts the transcript back, and the Notes tab with it. Escape collapses wherever the focus is, in the note too, unless a menu, a list or a window is open, which takes it first; the next Escape closes the recording as usual. Another recording opens with its transcript.

While the note is in the tab, Escape in it does nothing: it is a text field, and the recording stays open (`escape-close.ts`).

## The editor

`NoteEditor` is [Tiptap](https://tiptap.dev) 3 (ProseMirror), headless and drawn with the tokens only. Markdown typed turns into what it means at once, as in Typora: `#`, `##` and `###` and a space for headings, `-` or `*` for a list, `1.` for a numbered one, `- [ ]` or `[ ]` for a checkbox (`[x]` for a ticked one); `[ ]` at the start of a list item makes that item a checkbox, the list splitting around it and the checkbox joining any right before it, `>` for a quote, `**bold**`, `*italic*`, `[text](address)` for a link; Ctrl+B and Ctrl+I (⌘ on macOS) too. No tables, images or code. A ticked checkbox turns grey, not struck through. Undo and Redo (Ctrl+Z, Ctrl+Shift+Z) are the editor's own: they reach back to when the note opened in the tab or expanded, not across them.

A plain click on a link only puts the cursor in it; Ctrl+click (⌘ on macOS) hands it to the system browser or mail app through `openLink()` of the preload. Only `http`, `https` and `mailto` addresses open (`electron/links.js`); the window itself never follows a link.

The editor is a third of the UI's code, so it is a chunk of its own (`React.lazy` in `EditorNotes.tsx`), loaded the first time a note opens.

The schema also has two chips, a moment of the recording and a mention of a speaker or a person, which a note may hold; the app has no way to add them yet, and @ is plain text.

## Saving

There is no Save. `useNotesSaver()` in `EditorScreen` holds one saver for the screen (`createNoteAutosave()` in `note-autosave.ts`):

- About a second after typing stops (`NOTE_SAVE_DELAY_MS`), the note is saved with `PUT /transcripts/{id}/note`; an empty one is deleted with `DELETE`.
- At once when the recording shown changes (another one, a job, or none), when the screen goes, and before the window closes or the app quits.
- One request at a time, with the newest text only: a change made during a save goes after it.
- A save that fails says so once, "Failed to save notes: …", until one succeeds. The text stays in the editor and is tried again with the next change and at each of the moments above. A recording deleted meanwhile is no failure: its note went with it.

Every change is also kept in the query cache of the note at once (`useKeepNote()`), which is never loaded again while the app runs, so the note moving between the tab and the centre, or the recording opened again, shows what was typed, saved or not.

Closing the window to the tray destroys it and quitting gives the page no unload, so before either the main process asks the page to finish (`askWindowToFinish()` in `electron/window-closing.js`, the `window-closing` message) and waits for its answer, up to 1.5 s; the page runs what `onBeforeClose()` registered (`ui/src/platform/before-close.ts`), the saver among them. A reload or a page left in the browser runs them on `pagehide`, without waiting.

## Copy notes

Copy notes, in the header, puts the note on the clipboard as Markdown (`note-markdown.ts`): headings `#`, lists `-` and `1.`, checkboxes `- [ ]` and `- [x]`, quotes `>`, `**bold**`, `*italic*`, `[text](address)`; empty paragraphs are left out. It is off while the note is empty. It says nothing when done, as Copy transcript.

## Deleting

A note goes with its recording: Delete recording and Delete all data remove it on the backend. The delete dialog of a recording with a note says so: "The transcript, its notes and its recording made in Sonorus will be deleted." (`has_note` of `GET /transcripts`).

## Stories

Screens / Editor / Notes shows the notes as the app has them on fixtures (the weekly sync has a note): Closed, Notes Tab Empty, Notes Tab With Text, Notes Expanded, Save Failed (every save refused, typing says so) and Narrow Window. The stories after them are sketches of what the chips will do: the mention list, quotes from the transcript and Copy notes with chips. Components / NoteEditor and NotesPanel have a story for each of their states.
