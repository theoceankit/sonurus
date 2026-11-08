---
sidebar_position: 8
---

# New UI home

What the new UI shows before the user picks anything, and how files get in: which recording is open when the app starts and after the open one is deleted, the centre without recordings, and New recording, which records live or imports files, with the drags of files over the window.

## Which recording is open

With recordings in the list, one is always open. `EditorScreen` picks one whenever none is: when the list first loads and after the open recording is deleted. It waits for the list; while the list loads or the backend does not answer, nothing is picked.

The pick is `pickRecording(list, recent)` in `ui/src/screens/Home/last-opened.ts`, a pure function:

1. The last recording opened that is still in the list.
2. Otherwise the one opened before it, and so on down the list of recent ones.
3. With none of them left, the newest recording, which comes first in `GET /transcripts`.

So after a delete the recording opened before the deleted one opens, not its neighbour in the sidebar. The neighbour could not be known at startup anyway, if a recording was deleted while the app was closed.

The open recording can also go from elsewhere: Delete all data in Settings, or a delete in another window. When the list comes back without it (`goneFromList()` in `ui/src/screens/Editor/recordings.ts`: on the list before and not now), `EditorScreen` closes it: the transcript, the inspector and the player let it go, the sound stops, and its details and waveform leave the query cache. Then the pick above opens another one, or with no recordings left the centre shows the [empty state](#without-recordings) and the inspector and player stay empty. A recording the list has not had yet, such as one opened from the toast of a finished job before the list is read again, stays open.

`useRecentRecordings()` keeps the recent ones in Electron's `settings.json` as `recentTranscriptIds`: up to 20 ids, newest first. A recording goes first when it opens, whether the user clicked it or it was picked. It writes through the settings store of the new UI ([Electron overview](overview.md#settings)), which reads the file before each write and changes only this field, one write at a time, as the old UI shares the file and keeps its own fields there. A recording opened before the file has been read waits for it, so the saved list is not written over. Each time the list of recordings loads, the ids of recordings no longer in it, deleted here or in the old UI, leave the field. The old UI does not read the field and carries it along on its own writes, Reset to defaults included. Without Electron, in Storybook and tests, the list starts empty and lives in memory.

The backend is not involved: what was opened last is a setting of the interface, not data of a recording.

## Without recordings

When the backend answers with no recordings at all, the centre shows `EmptyState` (`ui/src/screens/Home/EmptyState.tsx`): how to make a new transcription, with the plus in the sentence on a chip as a key in a shortcut hint, centred on the capitals rather than the lowercase letters, and a line that transcribing needs models, which are downloaded in Settings. Settings there opens [Settings](new-ui-settings.md). The sidebar says No recordings yet as before. While the list loads, or when the backend does not answer, the centre stays empty and the sidebar says so: that is not the empty state.

## New recording dialog

`ImportDialog` in `ui/src/screens/Home/` is the old UI's New recording: a title, a model and a language for this run, and either a live recording or files. It is a medium `Modal` titled New recording, with "Make sure all participants have agreed to be recorded." under the title, the title field, Model and Language, the sources to record, Diarize speakers, a notice of missing models, a `DropZone`, the list of files, a refusal of the backend, and Import and Start recording. `useImportDialog()` holds its state and is called by `EditorScreen`, which puts the dialog next to its other ones.

- **Opening.** The plus in the title bar, New recording, opens it, and then it stays until closed. Files dragged over the window open it too: if they leave the window or the drag is cancelled with nothing dropped, it closes by itself. Once files are dropped or chosen it stays, also when none of them could be taken. While another window is open, such as Delete recording, New speaker or Settings, a drag does not open it, and a drop there adds nothing and says nothing; the window still does not open the file.
- **Files.** A drop anywhere in the window adds to the list while the dialog is open and no other window is over it, not only a drop on the zone. While Import sends the files, none can be added: Choose files is off, the zone does not light up and a drop adds nothing, as Title, Model and Language are off then. Choose files opens the system's file dialog (`openFiles()` of the preload). A file goes in when its extension is wav, mp3, m4a, flac, ogg, mp4, mkv or webm, in any case; anything else, or something that is not a file on disk, is not added, and a toast says its type is not supported, naming the file, or counting them when there are several, as the old UI does. The list holds only what will be imported. A file already listed is not added twice. A file added to the list opens in place, height and fade, so the list grows rather than jumps; one taken off goes at once.
- **Title.** The field shows the date and time of the opening, "5 Nov 14:30 Meeting", as a hint until the user types. One file keeps a typed title, trimmed; with nothing typed it is named after the file. With several files each is named after its file and the field is off.
- **Model and language.** Both start from the defaults of the settings ([New UI transcription](new-ui-transcribe.md#the-default-model)): the default model as worked out from what is installed, so a saved model that has been deleted is not used, and the saved language. A choice in the dialog is for this import only and is not saved; the next opening starts from the defaults again. Models not downloaded, and languages whose alignment model is not downloaded, are in the lists but off, marked Not installed. A model picked here stays while it is installed. The catalog is the last one known when the dialog opens and is asked for again; until there is one, Model says Checking models and Import is off.
- **Missing models.** Without a Whisper model, the diarization model or the alignment model of the language, a notice says which one, in the order the backend checks them, with Download in Settings, which opens [Settings](new-ui-settings.md) over the dialog, on Models or, for an alignment model, Languages. The dialog waits under it with its files, title, model and language; when Settings closes it is back, and a model downloaded meanwhile can be picked at once, since the end of a download asks for the catalog again. Import is off; files can still be added to the list.
- **Sources.** Under Model and Language, Record: Microphone and System audio, each a `SourceToggle` as in a call app. A click turns the source on or off for the recording, the arrow opens its devices with the chosen one checked, and the tooltip names the device. Microphones are the default one and the inputs of the computer: the dialog asks for the microphone once on opening, so their names can be read, and lets it go at once. System audio sources come from `GET /audio/capture/sources`; with none, its button is off and says that no system audio can be recorded on this computer. Each opening starts from the sources and devices saved last (`useRecordingSetup()` in `ui/src/recording/`); both on the first time. With both off, "Turn on the microphone or system audio to record." stands under them and Start recording is off.
- **Diarize speakers.** Drawn off and marked with `markNotImplemented()`: every transcription is diarized for now.
- **Start recording.** Saves the sources and devices as the defaults, the ones Settings shows under [Audio devices](new-ui-settings.md#audio-devices), but not the model and the language, closes and starts the recording with the title typed or the one the field shows, the model and the language: see [Live recording → New UI](live-recording.md#new-ui). It is off while models are missing, as Import is.
- **While recording.** The dialog only imports: "A recording is already in progress. Files can still be imported." stands over the sources, which are off, and Start recording is off.
- **Import.** Puts the files into the queue in the order of the list with `useAddToQueue()`, with the chosen model and language and the titles, ([New UI data](new-ui-data.md#hooks)), closes and shows "Importing N files…", or the name of one file. The jobs show in the queue above the recordings list ([New UI transcription](new-ui-transcribe.md#queue)), and the recording appears in the list when it is done.
- **Refusal.** The backend can still refuse on Import, such as for a model deleted after the dialog read the catalog, or a file it cannot read. Its message shows in the dialog, and the files stay; the message names a file, never shows its path ([`POST /queue/jobs`](../../api/endpoints.md#post-queuejobs)). The dialog acts on the `code` of the refusal, not on its wording: for a missing Whisper, diarization or alignment model it comes with Open Settings, which opens Settings over the dialog on the section of that model. A backend that does not answer shows as such. Changing the model or the language, or removing a file, clears the message. Files that went in before a refusal leave the list, so that Import does not send them twice.

`DropZone` in `ui/src/components/` is a dashed area with Choose files. Disabled, Choose files is off and it does not light up. It lights up only while files are over it, not anywhere over the window, counting enter and leave over its children as the window does. It keeps one size, with files listed or not. The drop itself is the window's. Its text cannot be selected, nor can the title of any modal: a press or a drag there selects nothing.

## Drags of files over the window

`watchFileDrags()` in `ui/src/screens/Home/import-files.ts` listens on the window, as `file-drop.js` does in the old UI:

- Only drags that carry files (`Files` in `dataTransfer.types`) are touched; dragging text keeps working.
- Enter and leave come for every element crossed, so they are counted, and only the first enter and the last leave reach the dialog. After a drop the count starts again.
- Every `dragover` and `drop` of files is cancelled, also over no zone at all. Otherwise Electron would open the file in the window instead of the app; `will-navigate` in `electron/main.js` blocks that as well.
- Whether files are for the dialog is asked at the drag's first enter and at the drop: not while another window is open (`openModalCount()` of `ui/src/components/Modal/open-modals.ts`, counting the dialog itself when it is open). A drop that is not for the dialog is cancelled all the same.

The modal does not stop the drags: Radix turns off pointer events under it, but drag events still reach the window.
