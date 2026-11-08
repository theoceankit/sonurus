---
sidebar_position: 10
---

# New UI transcription

What the new UI needs to start a transcription: the models of the catalog, which one is the default, and the languages a job can be asked for. The code is in `ui/src/transcribe/`; the screens that use it are described on their own pages.

## Models

`useModels()` reads `GET /models` ([New UI data](new-ui-data.md#client)). The rows of alignment models have only an id and whether they are installed, so their names and sizes are in `ALIGNMENT_MODELS` in `languages.ts`, as in the old UI's `data.js`. A build test (`tests/build/ui-alignment-catalog.test.js`) keeps its ids the same as the backend's `ALIGNMENT_CATALOG`, in its order.

A job needs a Whisper model, the diarization model and, for some languages, an alignment model. `jobBlockReason(state, language)` says what is missing in the order the backend checks it (`POST /queue/jobs` refuses the job with a 400 otherwise): `{ missing: 'whisper' }`, `{ missing: 'diarization' }` or `{ missing: 'alignment', language }`, or null when the job can start. `blockMessage(reason)` is the text for the user. A language with no row in the catalog needs no model: English, Spanish, German, French and Italian are aligned by torchaudio, and a detected language is known only once the job runs, where a missing model fails it with `alignment_model_missing`.

## The default model

There is no built-in default. Electron's settings keep the default Whisper model (`transcribeModel`) and the models that were the default before it (`transcribeModelHistory`, oldest first, at most five; `pushModelHistory`). `modelState(models, saved)` works the default out from what is installed with `resolveTranscribeModel`:

1. The saved model, if it is installed.
2. Otherwise the latest model of the history that is installed.
3. Otherwise the most accurate installed model: the last one in catalog order, from `tiny` to `large-v3`.
4. With no Whisper model installed, none.

A saved model that is not installed is therefore never used.

Like the old UI (`syncTranscribeModel`), the new one saves the default when it changes. `useDefaultModelSync()`, called once by `App`, works it out again with every new answer of `GET /models`, so the first model downloaded and the default deleted are the same step. `defaultModelChange(previous, models, saved)` compares the saved model as it was installed in the catalog before with the default now: a change is saved with its history and said in a toast, "Whisper Tiny is now the default transcription model" or "No transcription model installed — download one in Settings". The first answer is the baseline: an installed default stays silently, a saved one that is no longer installed is replaced at once. Picking a model in Settings saves it with `selectTranscribeModel(id)` (`ui/src/platform/transcribe-defaults.ts`), the latest of the history, without a toast.

## Downloads

`useModelDownloads()` in `model-downloads.ts` holds the model downloads of the app, one store per API client: a screen that starts a download and one that only shows the model see the same download, and it goes on when the screen closes. `GET /models` does not tell of running downloads; this does.

- `start(id)` sends `POST /models/{id}/download` with the HuggingFace token of the settings (`hfToken`) and follows `WS /ws/models/{job_id}`. A second start of a running download does nothing, and the backend also joins a second request for the same model to the running job.
- `download(id)` is `{ pct }` while it runs, else null. `outcome(id)` says how the last download here ended: `done`, `failed` (an error of the backend, a refused start or a lost connection) or `cancelled`. `failure(id)` is why a failed one failed, as the `code` of the backend's error event says ([API](../../api/endpoints.md#ws-wsmodelsjob_id)): `no_token`, `no_access`, `network` or `failed`; a refused start, a lost connection and a code this UI does not know are `failed`. Starting again clears both. The words for each are in `ui/src/transcribe/download-errors.ts`: `downloadFailureText()` for a place that links to API Keys, `downloadFailureLine()` for one line. The backend's message, the exception as raised, is not shown; it is in the backend's log.
- `cancel(id)` sends `DELETE /models/{id}/download/{job_id}`. A cancel before the backend answered the start stops the job once it does.
- A finished download reads the catalog again, so the model shows as installed everywhere.

## Queue

The transcription queue is a section of the recordings list, above the others, while it has jobs: `QueueSection` in `ui/src/screens/Queue/`, in the `top` slot of `Sidebar`. An empty queue takes no room; the slot, shared with the [recording in progress](./live-recording.md) above the queue, is at most 40 % of the sidebar's height. A longer queue scrolls under its header as the list does, with its own `ScrollBar` and a `ScrollFade` at the bottom while more rows are below; the slot's sections pad their own sides, so the bar stands in the same column as the list's. The snapshots come from `useQueue()`, which `useQueueEventsSync()` keeps up with `WS /ws/queue`. With the sidebar closed the queue is not shown.

- **Header.** "Queue", like the titles of the other sections, with Paused or Paused while recording beside it while the queue stands still (`queueStateLabel()`). It has no button.
- **Rows.** `QueueRow` in `ui/src/components/` is a row of the recordings list: the same height, title and status slot. A job not transcribed, waiting or failed, is in the secondary text colour. Across the title of the running job a lighter band passes now and then (`ui/src/styles/shimmer.module.css`, `--duration-shimmer`); with reduced motion it is plain text. A failed job has a red dot in the slot, where a new recording has its blue one. For a screen reader the slot names the state of every row: Waiting, Transcribing or Failed.
- **Buttons.** They show at the end of a row with the pointer, the focus, or while the row's menu is open, and are reached with Tab when hidden. A failed job has Retry, which puts it back at the end of the queue (`useRetryQueueJob()`). Every job has a menu, opened by its More button or by a right click on the row: Pause queue or Resume queue (`queueToggle()`, `useQueueControl()`; a pause stops the running job at once and it waits again at its place), Transcription settings for a job that is not running (`EditJobDialog`, [Job settings dialog](#job-settings-dialog)), and Delete from queue.
- **Delete** asks first in a danger dialog (`DeleteJobDialog`, focus on Cancel) with the text of `deleteJobPrompt()`: an imported file (`sonorus-import-*` in `recordings/`) keeps the user's original, anything else is a live recording, deleted for good. It sends `DELETE /queue/jobs/{id}`, which stops the job first if it runs; a job already gone counts as deleted. The dialog plays its way out also when the last job goes and the queue with it.
- **Order.** A row is dragged with the mouse onto another, before or after it by the half the pointer is on (`dropPlace()`, `reorderJobIds()`), and the new order goes to `PUT /queue/order` (`useReorderQueue()`). The drag carries its own type, `application/x-sonorus-job`, so a row is never taken for files dropped on the window, whose drop zone takes only files. While a row is dragged the queue stays as it was when the drag began, and the latest snapshot shows after the drop. From the keyboard, Alt+Up and Alt+Down on a focused row move it a step (`moveJob()`); the row keeps the focus in its new place, and its button, which takes the focus, carries the keys in `aria-keyshortcuts`. The new order shows at once and is kept over the snapshots until the backend answers (`applyOrder()`): a snapshot from the socket in the meantime, such as the next step of the running job, would show the old order. A refusal brings the old order back.
- A refusal of the backend for any of these is a toast with its text; the queue shows what the backend has.

### A job in the centre

A click on a row picks the job: `EditorScreen` shows `QueueJobPanel` in the centre in place of the recording, and the recording comes back when one is picked in the list or the job leaves the queue (it finished or was deleted). The inspector and the player show nothing meanwhile. `QueueJobView` is laid out as a transcript's header, the title where a transcript's stands: the title, the status (`jobStatusText()`: the step of the running job, which glints like its row but stays in the secondary colour of the other statuses, also with reduced motion; Waiting in the queue, or Waiting, queue paused; for a failed job, in red, the model that is missing or else Transcription failed), and Retry and Transcription settings under it. Delete from queue is in the More menu at the top right. A failed job's whole error, as the backend gave it, is folded under Show log, as the text of a review card is (`Reveal`), and scrolls past `--size-queue-log`. This is where the error stays once its toast is gone.

In Storybook, `Screens/Editor` shows the whole app on the fixtures' queue: With queue (a job of each kind, every button working), With queue paused, Queue transcribing (a job that finishes, with its toast), Queue failed, With long queue (more jobs than the slot holds) and Recording with long queue; `Screens/Queue/Job view` shows the centre in each state.

### Finished and failed jobs

`App` passes every queue event to `useQueueToasts()`, which shows what `queueEventToast()` makes of it (`ui/src/screens/Queue/queue-toasts.ts`):

- `job_done` — a toast "Title" is ready, with Open. Open asks `EditorScreen` for the recording (`openRequest`, a new object each time, so the same recording can be asked for again after leaving it). The toast goes as soon as its recording has been in the list of recordings and is no longer there (deleted in the Editor, or Delete all data), and Open opens nothing that the list has lost. A recording only just made may be missing from a list loaded before it, so that alone does not close the toast.
- `job_failed` — an error toast Transcription failed: "Title". A job that failed on a missing alignment model has the [Alignment model dialog](#alignment-model-dialog) instead.

## Alignment model dialog

A job in a language whose alignment model is not downloaded fails mid-pipeline with `alignment_model_missing`, as a detected language is known only then. `useAlignmentDialogs()` in `ui/src/screens/Queue/`, called by `App`, takes these `job_failed` events from `useQueueEventsSync()` and shows `AlignmentDialog` for the language of the job, so the model can be downloaded and the jobs retried without going to Settings.

- **Waits for open windows.** While another window is open, such as New transcription or Delete recording, the dialog waits and the job shows as failed in the queue; it opens when no window is left (`useOpenModalCount()`). Once shown it stays until closed.
- **One per language.** Several jobs often fail on one model: a language already shown or waiting is not added again. Languages wait in the order their jobs failed and are shown one at a time; the old UI put the windows on top of each other. Once a dialog is closed, the next failure of its language opens it again.
- **Offer.** The language, its name in itself and the size of the model, with Download and Dismiss.
- **Downloading.** The progress in per cent, with Cancel, which stops the download and closes the dialog. The download is the app's ([Downloads](#downloads)): a download of the model started elsewhere shows here as progress, and closing the dialog leaves it running.
- **Ready.** The model is installed, also when it already was by the time the dialog opened. One button, Retry transcription or Retry N transcriptions, puts every job that failed on this model back at the end of the queue, in queue order (`POST /queue/jobs/{id}/retry`); a refusal is a toast. With no such job left there is only Close.
- **Failed.** The last download of the model from this dialog ended without it. Try again starts it anew; Open Settings closes the dialog and opens [Settings](new-ui-settings.md).

## Job settings dialog

`EditJobDialog` in `ui/src/screens/Queue/` changes the title, the model and the language of a job that waits or failed; `canEditJob()` is false for the running one, which the backend refuses to change. It is what Transcription settings opens, in the menu of a queue row and in the centre for a picked job ([Queue](#queue)).

- It starts with the job as it is, the title focused. The lists are those of the import dialog: models and languages without their models are off. The job's own model stays in the list when it has been deleted, until another is picked.
- Save sends only what changed (`jobEditPatch()`), the title trimmed, Detect as null, through `useUpdateQueueJob()` (`PATCH /queue/jobs/{id}`). Nothing changed closes without a request. Enter in the title saves, Escape closes without saving.
- A blank title or one over 200 characters is an error under the title. So is a refusal of the backend, such as a model not installed or a job that started running meanwhile; the dialog stays open. The next change clears it.

`JobSettingsDialog` is its view, for the stories of its states.

## Languages

`LANGUAGES` is the list a job can be asked for, Detect automatically first. `auto` is what the settings and the screens keep; the API takes it as null (`apiLanguage`). `languageName(code)` is the name for the user.
