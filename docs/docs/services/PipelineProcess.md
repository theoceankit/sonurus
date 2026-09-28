---
sidebar_position: 9
---

# Pipeline Process

`app/services/pipeline_process.py` runs the transcription pipeline of a queued job ([Transcription Queue](TranscriptionQueue.md)) in a child process.

---

## Why a child process

A thread cannot be stopped from outside. A cancelled job used to run until the next progress checkpoint, and `Transcribing audio…` (Whisper, alignment and diarization in one call) can take minutes. A child process is stopped at once, on any step, and all its memory — GPU memory included — is freed when it exits.

The cost is the child's start-up: it imports torch, WhisperX and PyAnnote again, about 3 s per job on top of loading the models (which every job did before as well).

---

## Split of work

| Child process | Backend process |
|---|---|
| `create_controller()`, `run_pipeline()` — models, ASR, alignment, diarization, embeddings, speaker resolution (reads speaker memory) | Title, `storage.save()`, `CommitService.commit_recognized_speakers()`, `api_memory.reload()` |

The child only computes and sends the `Transcript` back (pickled, per-segment embeddings included). A stopped job therefore never leaves anything in the database.

---

## `run_pipeline_process(args, on_progress, cancel_event)`

`args`: `audio_path`, `whisper_model`, `language`, `db_path` (speaker memory, read only). Starts a `spawn` child, relays its progress to `on_progress`, and returns the `Transcript`.

- `cancel_event` is checked every 0.2 s; once set, the child is terminated (killed after 5 s) and `PipelineCancelled` is raised. Pausing the queue, a live recording starting, deleting the running job and backend shutdown set it.
- If `on_progress` raises, the child is stopped and the exception propagates.
- The child never outlives the call.

Messages from the child (over a `Pipe`):

| Message | Result in the backend |
|---|---|
| `("progress", step)` | `on_progress(step)` |
| `("done", transcript)` | returned |
| `("alignment_missing", language)` | `AlignmentModelMissingError(language)` → structured WS error |
| `("error", type_name, message)` | `RuntimeError(message)` |
| none, child killed by SIGTERM / SIGINT / SIGHUP | `PipelineInterrupted` (a `PipelineCancelled`): stopped from outside, not a failure |
| none, child exited otherwise (e.g. the OOM killer's SIGKILL) | `RuntimeError("Transcription process exited unexpectedly (code N)")` |

### The child's lifetime belongs to the backend

The child starts in `_child_main()`:

- On POSIX it calls `os.setsid()`, and it ignores SIGINT. Ctrl+C in a terminal or a signal to the backend's process group goes through the backend's shutdown, which stops the child and keeps its job in the queue — a child dying first would otherwise fail the job.
- A **lifeline** pipe: the backend holds the write end and never writes. If the backend dies without stopping the child (SIGKILL, crash), the pipe closes and the child exits at once instead of holding the GPU until the job ends.

A signal sent to every process (session logout, system shutdown) still reaches the child; that death is `PipelineInterrupted` and the job goes back to `waiting`.

ML modules are imported inside the worker, not at module level: the spawned child imports this module first, and warnings are silenced before those libraries load and again after (Lightning resets its logger levels on import).

---

## Tests

`RUN_PIPELINE_IN_SUBPROCESS` is `True` in production. `tests/conftest.py` sets it to `False`: API tests patch `create_controller` in the test process, which only works when the pipeline runs in-process (the router then also calls `_release_models()` to drop model references and empty the CUDA cache). `tests/test_pipeline_process.py` covers the child-process path with app-free stand-in workers from `tests/pipeline_workers.py`.
