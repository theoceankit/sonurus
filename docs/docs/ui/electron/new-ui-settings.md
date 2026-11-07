---
sidebar_position: 11
---

# New UI settings

Settings in the new UI (`ui/src/screens/Settings/`) are one large modal with the sections in a column at its side. They apply as they change: there is nothing to save, and the window only closes. The old UI keeps its own Settings screen; both read and write the same `settings.json` ([Electron overview](overview.md#settings)).

## Opening

`SettingsProvider`, around the screens in `App`, holds the one Settings window of the app. `useSettingsDialog().open(section?)` opens it on a section, the first one by default. It opens from:

- the Settings button of the titlebar;
- Settings in the line of the empty state ([New UI home](new-ui-home.md#without-recordings));
- Download in Settings and Open Settings in the New transcription dialog, which opens Settings over it and is back with its files when Settings close ([New UI home](new-ui-home.md#new-recording-dialog)), and Open Settings in the failed state of the Alignment model dialog ([New UI transcription](new-ui-transcribe.md)), which closes that dialog first.

Without a provider, as for a screen alone in a story or a test, `open` does nothing.

`SettingsDialog` is `Modal size="large" scrim="auto"`: over another window its scrim is clear, alone it dims. It has `Tabs orientation="vertical"`: a search over the sections, marked with `markNotImplemented()` until settings can be found by name, a `NavTab` per section, the version line under them (`formatAppVersion` of `getAppVersion()`: "Sonorus 0.3.0", "Sonorus" alone without a version) and the panel of the section next to them. Opening puts the focus on the selected section in the column, not on the first control of its panel. The window keeps one height (`--size-settings-height`) whatever the section, down to what a small window leaves; the panel scrolls.

## General

- **Transcription language**, `transcribeLang`, the default of new transcriptions; Detect automatically is `auto`. A language whose alignment model is not downloaded gets a notice under the row with Download and the model's size; while it downloads, the percentage and Cancel. The download is the one of the app ([New UI transcription](new-ui-transcribe.md#downloads)): it goes on when Settings close. A saved language that is not in the list, such as one picked in the old UI, is still shown, by the name of its alignment model.
- **Start transcription**, Automatically or Manually. The backend keeps it with the queue (`PUT /queue/settings`), not in `settings.json`; the field shows the value of the queue snapshot and is off until the queue has answered.

## Appearance

- **Theme**, System, Light or Dark, marked with `markNotImplemented()`: the app follows the system for now.
- **App language** is marked with `markNotImplemented()`: the interface has one language.
- **Interface scale**, 50 to 200% in steps of 5, with marks at 50, 100, 150 and 200%. The slider follows the pointer; when it lets go, or a key is released, the window zooms (`setZoom`) and `scale` is saved. The new UI applies the saved scale on start.

## Models

The Whisper models and the diarization model, each in its card, as `ModelRow` rows from `GET /models`: name, size and speed; the row of the default Whisper model is tinted, with Default under its name. The buttons say the state; there is no status in words next to them. While new jobs cannot start, a hint over the cards says why: no Whisper model, or no diarization model. The diarization card says that its download needs a HuggingFace token, with a link to API Keys, where it is entered.

- **Download** starts the download of the app (`useModelDownloads()`); the row shows the percentage and Cancel, also after Settings were closed and opened again. Once the model is installed the catalog is read again, and a first Whisper model becomes the default ([New UI transcription](new-ui-transcribe.md#the-default-model)).
- **Failed.** A download that failed says so in its row, "Download failed: " and the reason the backend gave (`error(id)`), with Retry, which starts it anew. There is no toast: the row is where the model is.
- **Use**, or a click on the row of an installed Whisper model, makes it the default (`selectTranscribeModel`). The diarization model has no Use: every job needs it.
- **Delete**, on an installed model, as in the old UI (`ui/src/transcribe/model-delete.ts`). Every job needs the diarization model, a Whisper model only its own jobs, an alignment model the jobs in its language. A model no waiting or failed job needs is deleted at once (`DELETE /models/{id}`). One that some need asks first, "2 jobs in the queue use Whisper Small. Delete anyway?". One the running transcription needs cannot be deleted: the button is off with the reason in a tooltip, and the backend answers 409 anyway; any refusal of the backend is said in a toast and the model stays. After a delete the catalog is read again, so the default moves on with its toast; when the alignment model of the default language goes, the language becomes Detect automatically, with a toast.

While `GET /models` has not answered the section says Checking models…, and that the transcription service does not answer when it fails.

## Languages

The alignment models of the catalog (`ALIGNMENT_MODELS`), in its order, with the English name of the language and the size, Download, Cancel and the failed state as in Models. Over them the card names the languages of the list that need no model of their own, worked out from the catalog. It does not say where the models are kept: the API does not tell the real folder. The section is `alignment` in code, as in the links that open it.

## GPU

GPU acceleration of the packaged app, after Languages; on macOS there is no section, as the backend has nothing to offer there (`getPlatform()`, or `GET /gpu` saying `unsupported_platform`). `ui/src/settings/gpu.ts` is the old UI's `gpu-acceleration.js` in TypeScript, one store per API client (`useGpu()`): `GET /gpu`, the CUDA download over `WS /ws/gpu/{job_id}` with its download and install phases, Cancel, Remove, and the restart of the backend that applies either ([GPU acceleration](gpu-acceleration.md)). It belongs to the app: closing Settings stops neither a download nor a restart. As in the old UI, the status is asked when the section opens.

`gpuSectionView(status, ui)` says what the card shows, as in the old UI: a medium badge (Development build, Not installed, Downloading, Installing, Waiting to apply, Removing, Restarting, On, GPU check failed, Update needed, or why the GPU does not qualify), the card and driver, the device the backend runs on, the detail, the progress, and the buttons. A download is offered only while the GPU qualifies; an installed pack can always be removed. While the app restarts the backend for the change, the toast that the backend is not responding stays away. The toasts after a restart are those of the old UI: GPU acceleration is on, the check failed, or it was removed.

## Audio devices

The devices a new recording starts with, in one card, Live recording: Microphone, the default one or an input of the computer, and System audio source, from `GET /audio/capture/sources`. They are `recordingMicDevice` (null for the default microphone) and `recordingSystemDevice` of the settings file, the values New recording saves when it starts a recording ([New UI home](new-ui-home.md#new-recording-dialog)), so the two always show the same. A device that is gone shows the first one in its place. Where no system audio can be captured, its field says Not available and is off. The old UI's Include microphone switch, which nothing read, is not here: New recording turns the microphone on and off.

## API Keys

The HuggingFace token (`hfToken`), hidden until the eye button shows it. It is saved when the field is left or on Enter, without spaces around it. Model downloads send it with each request ([New UI transcription](new-ui-transcribe.md#downloads)); the main process reads it when it starts the backend.

## Export

Shown and marked with `markNotImplemented()` as a whole, as in the old UI: export does not exist yet, so its format, Duplicate on export and what to include change nothing.

## Data

- **Reset preferences** puts every preference of `DEFAULT_SETTINGS` back (`defaultSettingsPatch`), applies 100% scale and says so in a toast. The HuggingFace token and the recordings opened last are not preferences and stay; so do transcripts, models and recordings. Start transcription belongs to the queue and is not reset, as in the old UI.
- **Delete all data** sends `POST /data/reset`: every transcript, speaker with its voice profile and recording made in Sonorus goes; imported audio files, models and preferences stay. A toast says what was deleted, "Deleted 3 transcripts, 2 speakers and 4 files." The recordings, speakers and queue are read again, so the window behind shows the empty state. The button is off while a transcription or a live recording runs, with the reason in a tooltip; the backend also refuses then, and its refusal is said in a toast.

Both ask first ([Confirmations](#confirmations)).

## Confirmations

A destructive step asks in `ConfirmDialog`, a danger `Modal` over Settings: the `alertdialog` role and focus on Cancel. Escape, the scrim and Cancel close only it, and Settings stays open. Focus goes back to the button that asked; when that is gone, such as the delete button of a model just deleted, to Settings. The confirm button is busy until the step is done. The scrim under it dims Settings again (`scrim="dim"`); `scrim="clear"` leaves the dimming to the scrim of Settings. Both are in Storybook, Modal → Over another window.
