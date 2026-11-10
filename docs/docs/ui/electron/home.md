---
sidebar_position: 8
---

# Home

What the UI shows before the user picks anything, and how files get in: which recording is open when the app starts and after the open one is deleted, the centre without recordings, and how a new transcription starts: New recording, which records live, and Import files, which takes files chosen or dragged over the window.

## Which recording is open

With recordings in the list, one is always open. `EditorScreen` picks one whenever none is: when the list first loads and after the open recording is deleted. It waits for the list; while the list loads or the backend does not answer, nothing is picked.

The pick is `pickRecording(list, recent)` in `ui/src/screens/Home/last-opened.ts`, a pure function:

1. The last recording opened that is still in the list.
2. Otherwise the one opened before it, and so on down the list of recent ones.
3. With none of them left, the newest recording, which comes first in `GET /transcripts`.

So after a delete the recording opened before the deleted one opens, not its neighbour in the sidebar. The neighbour could not be known at startup anyway, if a recording was deleted while the app was closed.

The open recording can also go from elsewhere: Delete all data in Settings, or a delete in another window. When the list comes back without it (`goneFromList()` in `ui/src/screens/Editor/recordings.ts`: on the list before and not now), `EditorScreen` closes it: the transcript, the inspector and the player let it go, the sound stops, and its details and waveform leave the query cache. Then the pick above opens another one, or with no recordings left the centre shows the [empty state](#without-recordings) and the inspector and player stay empty. A recording the list has not had yet, such as one opened from the toast of a finished job before the list is read again, stays open.

`useRecentRecordings()` keeps the recent ones in Electron's `settings.json` as `recentTranscriptIds`: up to 20 ids, newest first. A recording goes first when it opens, whether the user clicked it or it was picked. It writes through the settings store of the UI ([Electron overview](overview.md#settings)), which reads the file before each write and changes only this field, one write at a time. A recording opened before the file has been read waits for it, so the saved list is not written over. Each time the list of recordings loads, the ids of recordings no longer in it leave the field. Reset preferences keeps it. Without Electron, in Storybook and tests, the list starts empty and lives in memory.

The backend is not involved: what was opened last is a setting of the interface, not data of a recording.

## Without recordings

When the backend answers with no recordings at all, the centre shows `EmptyState` (`ui/src/screens/Home/EmptyState.tsx`): how to make a new transcription, with the plus in the sentence on a chip as a key in a shortcut hint, centred on the capitals rather than the lowercase letters, then "Or drop audio or video files into the window.", and a line that transcribing needs models, which are downloaded in Settings. Settings there opens [Settings](settings.md). The sidebar says No recordings yet as before. While the list loads, or when the backend does not answer, the centre stays empty and the sidebar says so: that is not the empty state.

## New recording dialog

A new transcription starts in one of two dialogs in `ui/src/screens/Home/`: `NewRecordingDialog`, New recording, records live; `ImportDialog`, Import files, takes files. Only one of them is open at a time, and one takes the place of the other. `useNewTranscription()` holds the state of both and is called by `EditorScreen`, which puts them next to its other dialogs. The model and the language are one for both: picked in New recording, they are there in Import files. A title typed in New recording names the first file added to Import files.

New recording is a medium `Modal` titled New recording, with "Make sure all participants have agreed to be recorded." under the title, the title field, Model and Language, the sources to record, a notice of missing models, and Import files at the left of the footer and Start recording at the right. It has no Cancel: the cross closes it.

- **Opening.** The plus in the title bar, New recording, opens it, and then it stays until closed. Each opening starts afresh: no title, the default model and language, the sources and devices saved last.
- **Import files.** Puts Import files in its place, with the model and the language picked so far; the title typed goes to the first file added. There is no way back: closing Import files closes both.
- **Files dragged over it.** Import files takes its place in the same way while files are over the window. Dropped, they go to its list, the first named with the title typed, and Import files stays. If they leave the window or the drag is cancelled with nothing dropped, New recording is back as it was, with the title, the model, the language and the sources picked.
- **Title.** The field shows the date and time of the opening, "5 Nov 14:30 Meeting", as a hint until the user types; a recording started with nothing typed gets that title.
- **Model and language.** Both start from the defaults of the settings ([Transcription](transcribe.md#the-default-model)): the default model as worked out from what is installed, so a saved model that has been deleted is not used, and the saved language. A choice in the dialog is for this run only and is not saved; the next opening starts from the defaults again. Models not downloaded, and languages whose alignment model is not downloaded, are in the lists but off, marked Not installed. A model picked here stays while it is installed. The catalog is the last one known when the dialog opens and is asked for again; until there is one, Model says Checking models. The settings are read again on each opening; until they are read the first time, Model says Checking models, Language says Checking, and Start recording is off, so no other default shows first. Model and Language are `TranscribeFields` and the notice of missing models is `MissingModelNotice`, which Import files has as well.
- **Missing models.** Without a Whisper model, the diarization model or the alignment model of the language, a notice says which one, in the order the backend checks them, with Download in Settings, which opens [Settings](settings.md) over the dialog, on Models or, for an alignment model, Languages. The dialog waits under it; when Settings closes it is back, and a model downloaded meanwhile can be picked at once, since the end of a download asks for the catalog again. Start recording is off.
- **Sources.** Under Model and Language, Record: Microphone and System audio, each a `SourceToggle` as in a call app. A click turns the source on or off for the recording, the arrow opens its devices with the chosen one checked, and the tooltip names the device. Microphones are the default one and the inputs of the computer: the dialog asks for the microphone once on opening, so their names can be read, and lets it go at once. System audio sources come from `GET /audio/capture/sources`; with none, its button is off and says that no system audio can be recorded on this computer. Each opening starts from the sources and devices saved last (`useRecordingSetup()` in `ui/src/recording/`); both on the first time. With both off, "Turn on the microphone or system audio to record." stands under them and Start recording is off.
- **Start recording.** Saves the sources and devices as the defaults, the ones Settings shows under [Audio devices](settings.md#audio-devices), but not the model and the language, closes and starts the recording with the title typed or the one the field shows, the model and the language: see [Live recording → New UI](live-recording.md#in-the-window).
- **While recording.** "A recording is already in progress." stands over the sources, which are off, and Start recording is off. Import files works as always.

## Import files dialog

Import files is a medium `Modal` titled Import files, with no line under the title: Model and Language, the list of files, a `DropZone`, then what is wrong, a notice of missing models or a refusal of the backend, and Cancel and Import. There is no title field: each file is named in the list.

- **Opening.** Import files in New recording opens it in its place, and then it stays until closed. Files dragged over the window open it too, with nothing else open: if they leave the window or the drag is cancelled with nothing dropped, it closes by itself. Once files are dropped or chosen it stays, also when none of them could be taken. While another window is open, such as Delete recording, New speaker or Settings, a drag does not open it, and a drop there adds nothing and says nothing; the window still does not open the file. Opened by a drag, it starts afresh, as New recording does.
- **Files.** A drop anywhere in the window adds to the list while the dialog is open and no other window is over it, not only a drop on the zone. While Import sends the files, none can be added: Choose files is off, the zone does not light up and a drop adds nothing, as Title, Model and Language are off then. Choose files opens the system's file dialog (`openFiles()` of the preload). A file goes in when its extension is wav, mp3, m4a, flac, ogg, mp4, mkv or webm, in any case; anything else, or something that is not a file on disk, is not added, and a toast says its type is not supported, naming the file, or counting them when there are several. The list holds only what will be imported. A file already listed is not added twice. A file added to the list opens in place, height and fade, so the list grows rather than jumps; one taken off goes at once.
- **Titles.** Each file is named after itself, without its extension. A click on its name edits it in place, the extension after the field and not part of it; Enter or leaving the field keeps the title, trimmed, and Escape keeps the one it had, without closing the dialog. A blank title, or the file's own name, names it after the file again. While Import sends the files, they cannot be renamed.
- **Model and language, missing models.** As in New recording; Import is off while models are missing or the catalog and the settings are not read yet, and files can still be added to the list. Under Settings opened from the notice the dialog waits with its files, their titles, the model and the language.
- **While recording.** Nothing changes: a recording and an import do not get in each other's way.
- **Import.** Puts the files into the queue in the order of the list with `useAddToQueue()`, with the chosen model and language and the titles ([Data](data.md#hooks)), closes and shows "Importing N files…", or the name of one file. The jobs show in the queue above the recordings list ([Transcription](transcribe.md#queue)), and the recording appears in the list when it is done.
- **Refusal.** The backend can still refuse on Import, such as for a model deleted after the dialog read the catalog, or a file it cannot read. Its message shows in the dialog, and the files stay; the message names a file, never shows its path ([`POST /queue/jobs`](../../api/endpoints.md#post-queuejobs)). The dialog acts on the `code` of the refusal, not on its wording (`refusalOf()` in `ui/src/transcribe/refusals.ts`, shown by `RefusalNote`, which the job settings dialog uses too): for a missing Whisper, diarization or alignment model it comes with Open Settings, which opens Settings over the dialog on the section of that model. A backend that does not answer shows as such. Changing the model or the language, or removing a file, clears the message. Files that went in before a refusal leave the list, so that Import does not send them twice.

`DropZone` in `ui/src/components/` is a dashed area with Choose files. Disabled, Choose files is off and it does not light up. It lights up only while files are over it, not anywhere over the window, counting enter and leave over its children as the window does. It keeps one size, with files listed or not. The drop itself is the window's. Its text cannot be selected, nor can the title of any modal: a press or a drag there selects nothing.

## Drags of files over the window

`watchFileDrags()` in `ui/src/screens/Home/import-files.ts` listens on the window:

- Only drags that carry files (`Files` in `dataTransfer.types`) are touched; dragging text keeps working.
- Enter and leave come for every element crossed, so they are counted, and only the first enter and the last leave reach the dialogs. After a drop the count starts again.
- Every `dragover` and `drop` of files is cancelled, also over no zone at all. Otherwise Electron would open the file in the window instead of the app; `will-navigate` in `electron/main.js` blocks that as well.
- Whether files are for Import files is asked at the drag's first enter and at the drop: not while another window is open (`openModalCount()` of `ui/src/components/Modal/open-modals.ts`, counting New recording or Import files when one is open). A drop that is not for it is cancelled all the same.

The modal does not stop the drags: Radix turns off pointer events under it, but drag events still reach the window.
