---
sidebar_position: 8
---

# New UI home

What the new UI shows before the user picks anything, and how files get in: which recording is open when the app starts and after the open one is deleted, the centre without recordings, and the import dialog with the drags of files over the window.

## Which recording is open

With recordings in the list, one is always open. `EditorScreen` picks one whenever none is: when the list first loads and after the open recording is deleted. It waits for the list; while the list loads or the backend does not answer, nothing is picked.

The pick is `pickRecording(list, recent)` in `ui/src/screens/Home/last-opened.ts`, a pure function:

1. The last recording opened that is still in the list.
2. Otherwise the one opened before it, and so on down the list of recent ones.
3. With none of them left, the newest recording, which comes first in `GET /transcripts`.

So after a delete the recording opened before the deleted one opens, not its neighbour in the sidebar. The neighbour could not be known at startup anyway, if a recording was deleted while the app was closed.

`useRecentRecordings()` keeps the recent ones in Electron's `settings.json` as `recentTranscriptIds`: up to 20 ids, newest first. A recording goes first when it opens, whether the user clicked it or it was picked. It writes through the settings store of the new UI ([Electron overview](overview.md#settings)), which reads the file before each write and changes only this field, one write at a time, as the old UI shares the file and keeps its own fields there. The old UI does not read the field and carries it along on its own writes, Reset to defaults included. Without Electron, in Storybook and tests, the list starts empty and lives in memory.

The backend is not involved: what was opened last is a setting of the interface, not data of a recording.

## Without recordings

When the backend answers with no recordings at all, the centre shows `EmptyState` (`ui/src/screens/Home/EmptyState.tsx`): how to make a new transcription, with the plus in the sentence on a chip as a key in a shortcut hint, centred on the capitals rather than the lowercase letters, and a line that transcribing needs models, which are downloaded in Settings. Settings there opens [Settings](new-ui-settings.md). The sidebar says No recordings yet as before. While the list loads, or when the backend does not answer, the centre stays empty and the sidebar says so: that is not the empty state.

## Import dialog

`ImportDialog` in `ui/src/screens/Home/` is the old UI's New recording without the recording: files, with a title, a model and a language for this run. It is a medium `Modal` with the title field, Model and Language, Diarize speakers, a notice of missing models, a `DropZone`, the list of files, a refusal of the backend, and Import. `useImportDialog()` holds its state and is called by `EditorScreen`, which puts the dialog next to its other ones.

- **Opening.** The plus in the title bar, New transcription, opens it, and then it stays until closed. Files dragged over the window open it too: if they leave the window or the drag is cancelled with nothing dropped, it closes by itself. Once files are dropped or chosen it stays, also when none of them could be taken.
- **Files.** A drop anywhere in the window adds to the list while the dialog is open, not only a drop on the zone. Choose files opens the system's file dialog (`openFiles()` of the preload). A file goes in when its extension is wav, mp3, m4a, flac, ogg, mp4, mkv or webm, in any case; anything else, or something that is not a file on disk, is not added, and a toast says its type is not supported, naming the file, or counting them when there are several, as the old UI does. The list holds only what will be imported. A file already listed is not added twice. A file added to the list opens in place, height and fade, so the list grows rather than jumps; one taken off goes at once.
- **Title.** The field shows the date and time of the opening, "5 Nov 14:30 Meeting", as a hint until the user types. One file keeps a typed title, trimmed; with nothing typed it is named after the file. With several files each is named after its file and the field is off.
- **Model and language.** Both start from the defaults of the settings ([New UI transcription](new-ui-transcribe.md#the-default-model)): the default model as worked out from what is installed, so a saved model that has been deleted is not used, and the saved language. A choice in the dialog is for this import only and is not saved; the next opening starts from the defaults again. Models not downloaded, and languages whose alignment model is not downloaded, are in the lists but off, marked Not installed. A model picked here stays while it is installed. The catalog is the last one known when the dialog opens and is asked for again; until there is one, Model says Checking models and Import is off.
- **Missing models.** Without a Whisper model, the diarization model or the alignment model of the language, a notice says which one, in the order the backend checks them, with Download in Settings, which closes the dialog and opens [Settings](new-ui-settings.md). Import is off; files can still be added to the list.
- **Diarize speakers.** Drawn off and marked with `markNotImplemented()`: every transcription is diarized for now.
- **Import.** Puts the files into the queue in the order of the list with `useAddToQueue()`, with the chosen model and language and the titles, ([New UI data](new-ui-data.md#hooks)), closes and shows "Importing N files…", or the name of one file. The jobs show in the queue above the recordings list ([New UI transcription](new-ui-transcribe.md#queue)), and the recording appears in the list when it is done.
- **Refusal.** The backend can still refuse on Import, such as for a model deleted after the dialog read the catalog, or a file it cannot read. Its message shows in the dialog, and the files stay. For a missing model it comes with Open Settings, which closes the dialog and opens Settings. A backend that does not answer shows as such. Files that went in before a refusal leave the list, so that Import does not send them twice.

`DropZone` in `ui/src/components/` is a dashed area with Choose files. It lights up only while files are over it, not anywhere over the window, counting enter and leave over its children as the window does. It keeps one size, with files listed or not. The drop itself is the window's. Its text cannot be selected, nor can the title of any modal: a press or a drag there selects nothing.

## Drags of files over the window

`watchFileDrags()` in `ui/src/screens/Home/import-files.ts` listens on the window, as `file-drop.js` does in the old UI:

- Only drags that carry files (`Files` in `dataTransfer.types`) are touched; dragging text keeps working.
- Enter and leave come for every element crossed, so they are counted, and only the first enter and the last leave reach the dialog. After a drop the count starts again.
- Every `dragover` and `drop` of files is cancelled, also over no zone at all. Otherwise Electron would open the file in the window instead of the app; `will-navigate` in `electron/main.js` blocks that as well.
- A drop that something below has cancelled already is not taken a second time.

The modal does not stop the drags: Radix turns off pointer events under it, but drag events still reach the window.
