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

`useRecentRecordings()` keeps the recent ones in Electron's `settings.json` as `recentTranscriptIds`: up to 20 ids, newest first. A recording goes first when it opens, whether the user clicked it or it was picked. Each write reads the file first and changes only this field, one write at a time, as the old UI shares the file and keeps its own fields there. The old UI does not read the field and carries it along on its own writes, Reset to defaults included. Without Electron, in Storybook and tests, the list starts empty and lives in memory.

The backend is not involved: what was opened last is a setting of the interface, not data of a recording.

## Without recordings

When the backend answers with no recordings at all, the centre shows `EmptyState` (`ui/src/screens/Home/EmptyState.tsx`): how to make a new transcription, with the plus in the sentence on a chip as a key in a shortcut hint, centred on the capitals rather than the lowercase letters, and a line that transcribing needs models, which are downloaded in Settings. Settings there is marked with `markNotImplemented()` until the new UI has it. The sidebar says No recordings yet as before. While the list loads, or when the backend does not answer, the centre stays empty and the sidebar says so: that is not the empty state.

## Import dialog

`ImportDialog` in `ui/src/screens/Home/` is what will become New recording: for now it takes only files. It is a medium `Modal` with a `DropZone`, the list of files, a refusal of the backend, and Import. `useImportDialog()` holds its state and is called by `EditorScreen`, which puts the dialog next to its other ones.

- **Opening.** The plus in the title bar, New transcription, opens it, and then it stays until closed. Files dragged over the window open it too: if they leave the window or the drag is cancelled with nothing dropped, it closes by itself. Once files are dropped or chosen it stays, also when none of them could be taken.
- **Files.** A drop anywhere in the window adds to the list while the dialog is open, not only a drop on the zone. Choose files opens the system's file dialog (`openFiles()` of the preload). A file goes in when its extension is wav, mp3, m4a, flac, ogg, mp4, mkv or webm, in any case; anything else, or something that is not a file on disk, is not added, and a toast says its type is not supported, naming the file, or counting them when there are several, as the old UI does. The list holds only what will be imported. A file already listed is not added twice. A file added to the list opens in place, height and fade, so the list grows rather than jumps; one taken off goes at once.
- **Import.** Puts the files into the queue in the order of the list with `useAddToQueue()` ([New UI data](new-ui-data.md#hooks)), closes and shows "Importing N files…", or the name of one file. There is no queue in the new UI yet: the recording appears in the sidebar when it is done.
- **Refusal.** The dialog opens without downloaded models; the backend refuses on Import. Its message shows in the dialog, and the files stay. For a missing model it comes with Open Settings, marked with `markNotImplemented()` until the new UI has Settings. A backend that does not answer shows as such. Files that went in before a refusal leave the list, so that Import does not send them twice.

The model is the one saved in Settings of the old UI. Unlike the old UI, the new one does not check that it is installed: a saved model that has been deleted comes back as the backend's refusal.

`DropZone` in `ui/src/components/` is a dashed area with Choose files. It lights up only while files are over it, not anywhere over the window, counting enter and leave over its children as the window does. It keeps one size, with files listed or not. The drop itself is the window's. Its text cannot be selected, nor can the title of any modal: a press or a drag there selects nothing.

## Drags of files over the window

`watchFileDrags()` in `ui/src/screens/Home/import-files.ts` listens on the window, as `file-drop.js` does in the old UI:

- Only drags that carry files (`Files` in `dataTransfer.types`) are touched; dragging text keeps working.
- Enter and leave come for every element crossed, so they are counted, and only the first enter and the last leave reach the dialog. After a drop the count starts again.
- Every `dragover` and `drop` of files is cancelled, also over no zone at all. Otherwise Electron would open the file in the window instead of the app; `will-navigate` in `electron/main.js` blocks that as well.
- A drop that something below has cancelled already is not taken a second time.

The modal does not stop the drags: Radix turns off pointer events under it, but drag events still reach the window.
