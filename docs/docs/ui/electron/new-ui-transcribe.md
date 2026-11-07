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

A saved model that is not installed is therefore never used. The new UI works this out each time and does not save the result; the old UI saves it and says so in a toast when it changes (`syncTranscribeModel` in `electron/renderer/transcription-model.js`).

## Downloads

`useModelDownloads()` in `model-downloads.ts` holds the model downloads of the app, one store per API client: a screen that starts a download and one that only shows the model see the same download, and it goes on when the screen closes. `GET /models` does not tell of running downloads; this does.

- `start(id)` sends `POST /models/{id}/download` with the HuggingFace token of the settings (`hfToken`) and follows `WS /ws/models/{job_id}`. A second start of a running download does nothing, and the backend also joins a second request for the same model to the running job.
- `download(id)` is `{ pct }` while it runs, else null. `outcome(id)` says how the last download here ended: `done`, `failed` (an error of the backend, a refused start or a lost connection) or `cancelled`. Starting again clears it.
- `cancel(id)` sends `DELETE /models/{id}/download/{job_id}`. A cancel before the backend answered the start stops the job once it does.
- A finished download reads the catalog again, so the model shows as installed everywhere.

## Languages

`LANGUAGES` is the list a job can be asked for, Detect automatically first. `auto` is what the settings and the screens keep; the API takes it as null (`apiLanguage`). `languageName(code)` is the name for the user.
