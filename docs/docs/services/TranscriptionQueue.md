---
sidebar_position: 10
---

# Transcription Queue

`app/services/transcription_queue.py` (`TranscriptionQueue`) runs transcription jobs one at a time; `app/services/job_store.py` (`JobStore`) persists them. `app/services/transcription_job.py` (`make_job_runner`) is what runs one job. The API is described in [API Endpoints → Transcription queue](../api/endpoints.md#transcription-queue).

---

## Rules

- The queue as a whole is **running** or **paused**. Pausing stops the running job at once; it goes back to `waiting` and later runs again **from the start** (no partial progress is kept).
- After a backend restart the queue is always **paused**. A job left `running` (backend stopped mid-job) is `waiting` again.
- **Start mode** (stored): `auto` — a running queue waits for new jobs when it runs out of them, so adding a job runs it unless the queue is paused. `manual` — the queue pauses itself when nothing is left to run; jobs added while it runs are picked up in the same pass.
- **Live recording**: `recording_started()` pauses a running queue and stops its job (`paused_by_recording`). `recording_stopped()` resumes only in `auto` mode and only if the recording paused it; a pause by the user (before or during the recording) stays. Jobs can be added while recording.
- A **failed** job moves to the end of the queue with its error and is skipped until `retry()`, which puts it back at the end as `waiting`. It is never retried by itself: a persistent error would loop.
- A **finished** job leaves the queue — it is a transcript now (`job_done` event).
- `delete()` removes a job and its audio (`discard_owned_audio()`: the live recording or the import copy; the user's original is never touched). A running job is stopped first.
- Title, model and language can be edited on every job except the running one.

---

## Worker

One daemon thread (`start_worker()` / `stop_worker()`, called by the API lifespan) takes the first `waiting` job whenever the queue runs and nothing blocks it, marks it `running` and calls `run_job(job, on_progress, cancel_event)`. The outcome:

| Outcome | Job |
|---|---|
| Transcript id returned | Deleted from the queue; `job_done` |
| `PipelineCancelled` (pause, recording, delete, shutdown) | `waiting` (or deleted, if a delete stopped it) |
| `PipelineInterrupted` — the child was stopped from outside (SIGTERM/SIGINT/SIGHUP: logout, shutdown, a task manager) | `waiting`, and the queue pauses |
| Any other exception | `failed`, moved to the end; `job_failed`. `AlignmentModelMissingError` sets `error_code: "alignment_model_missing"` and `error_language` |
| Any exception while the worker is stopping | `waiting` (the child may die from the shutdown first) |

`stop_worker()` stops the running job; it stays in the queue as `waiting`.

`hold()` keeps the worker from starting a job and raises `QueueBusy` if one is running — `POST /data/reset` clears the queue inside it. `is_running()` is what `DELETE /speakers/{id}` checks: only a running job blocks it, queued ones resolve speakers when they run.

---

## Running one job — `make_job_runner(storage, memory_db_path, on_saved)`

1. `Loading models…`, then the pipeline — in a child process in production ([Pipeline Process](PipelineProcess.md)), in-process in tests (`create_controller()`, then `_release_models()`).
2. If the job was cancelled meanwhile: `PipelineCancelled`, nothing is saved.
3. The job's title is set, `Saving to database…`, `storage.save()`.
4. `CommitService.commit_recognized_speakers()`. A failure here is logged but does not fail the job — the transcript already exists and a retry would save it twice.
5. `on_saved()` (the API reloads its cached speaker memory); returns the transcript id.

---

## Events

`subscribe(callback)` delivers, after every change, a `snapshot` (the same shape as `GET /queue`) and the `job_done` / `job_failed` events. Snapshots are built and delivered under one lock, so a subscriber never gets an older snapshot after a newer one. Callbacks must be quick; `WS /ws/queue` hands them to the event loop with `call_soon_threadsafe`.

---

## Storage — `JobStore`

Tables in the same database file as transcripts (`DB_PATH`), created by `JobStore` itself:

- `transcription_jobs` (`id` TEXT PK, `position`, `audio_path`, `title`, `whisper_model`, `language`, `status` `waiting`/`running`/`failed`, `error`, `error_code`, `error_language`, `created_at`) — ordered by `position`.
- `transcription_queue_settings` (`key` PK, `value`) — `start_mode`.

Whether the queue is paused and which job runs are not stored.
