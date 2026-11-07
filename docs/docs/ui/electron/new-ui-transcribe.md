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

## Languages

`LANGUAGES` is the list a job can be asked for, Detect automatically first. `auto` is what the settings and the screens keep; the API takes it as null (`apiLanguage`). `languageName(code)` is the name for the user.
