"""The transcription queue: one worker thread running persisted jobs in order.

The queue as a whole is running or paused. Pausing interrupts the running
job, which runs again from the start when the queue resumes (no partial
progress is kept). A backend that starts with jobs waiting comes up paused,
so left-over work does not take the machine by itself; with nothing waiting
it comes up running in auto mode.

Start mode (stored):
- auto   — a running queue waits for new jobs when it runs out of them;
- manual — it pauses itself when nothing is left to run.

A live recording pauses the queue; when it stops, the queue resumes only in
auto mode and only if the recording was what paused it.

A failed job moves to the end of the queue and is skipped until retried.
A finished job leaves the queue — it is a transcript now.

The pipeline itself is `run_job(job, on_progress, cancel_event) -> transcript
id`; it raises PipelineCancelled once cancel_event is set.
"""
import threading
from contextlib import contextmanager
from pathlib import Path

from app.logger import get_logger
from app.services.audio_store import discard_owned_audio
from app.services.job_store import JobStore
from app.services.pipeline_process import PipelineCancelled, PipelineInterrupted
from app.services.transcription_service import AlignmentModelMissingError

log = get_logger("TranscriptionQueue")

START_MODES = ("auto", "manual")
_EDITABLE = {"title", "whisper_model", "language"}


class JobNotFound(Exception):
    pass


class JobRunning(Exception):
    pass


class JobNotFailed(Exception):
    pass


class QueueBusy(Exception):
    pass


class TranscriptionQueue:
    def __init__(self, store: JobStore, run_job, recordings_dir: str | Path):
        self._store = store
        self._run_job = run_job
        self._recordings_dir = recordings_dir
        store.reset_running()  # interrupted by a restart: run again

        self._cond = threading.Condition()
        self._start_mode = store.get_setting("start_mode", "auto")
        # Failed jobs don't count: they wait for Retry anyway.
        left_over = any(j["status"] == "waiting" for j in store.list())
        self._paused = left_over or self._start_mode == "manual"
        self._paused_by_recording = False
        self._recording = False
        self._running_id: str | None = None
        self._step: str | None = None
        self._cancel: threading.Event | None = None
        self._deleting: set[str] = set()
        self._delete_results: dict[str, bool] = {}
        self._held = 0
        self._stopping = False
        self._thread: threading.Thread | None = None
        self._subscribers: list = []
        # Snapshots are built and delivered in one go, so a subscriber never
        # gets an older snapshot after a newer one.
        self._publish_lock = threading.RLock()

    # ── Worker ──────────────────────────────────────────────────────────────

    def start_worker(self) -> None:
        self._thread = threading.Thread(target=self._work, name="transcription-queue", daemon=True)
        self._thread.start()

    def stop_worker(self, timeout: float = 10) -> None:
        """Stop the worker; a running job is interrupted and stays in the queue."""
        with self._cond:
            self._stopping = True
            if self._cancel is not None:
                self._cancel.set()
            self._cond.notify_all()
        if self._thread is not None:
            self._thread.join(timeout)

    def _work(self) -> None:
        while True:
            job, changed = self._take_next()
            if changed:
                self._publish()
            if job is None:
                if self._stopping:
                    return
                continue
            self._run(job)

    def _take_next(self) -> tuple[dict | None, bool]:
        """Block until a job can start (→ job, True) or the queue state
        changed by itself (→ None, True) or the worker stops (→ None, False)."""
        with self._cond:
            while not self._stopping:
                if not self._paused and not self._held:
                    job = next((j for j in self._store.list() if j["status"] == "waiting"), None)
                    if job is not None:
                        self._store.update(job["id"], status="running")
                        self._running_id = job["id"]
                        self._step = None
                        self._cancel = threading.Event()
                        return job, True
                    if self._start_mode == "manual":
                        self._paused = True  # ran out of jobs
                        return None, True
                self._cond.wait()
            return None, False

    def _run(self, job: dict) -> None:
        cancel = self._cancel

        def on_progress(step: str) -> None:
            if cancel.is_set():
                raise PipelineCancelled()
            with self._cond:
                self._step = step
            self._publish()

        try:
            outcome = ("done", self._run_job(job, on_progress, cancel))
        except PipelineInterrupted:
            outcome = ("interrupted",)
        except PipelineCancelled:
            outcome = ("cancelled",)
        except AlignmentModelMissingError as exc:
            outcome = ("failed", str(exc), "alignment_model_missing", exc.language)
        except Exception as exc:
            if self._stopping:
                # The backend is shutting down; the child may have died from
                # that before it was stopped. The job is interrupted, not failed.
                outcome = ("cancelled",)
            else:
                log.warning(f"Job {job['id']} failed: {exc}")
                outcome = ("failed", str(exc), None, None)

        events = []
        job_id = job["id"]
        with self._cond:
            deleting = job_id in self._deleting
            if outcome[0] == "done":
                self._store.delete(job_id)
                events.append({"type": "job_done", "job_id": job_id, "title": job["title"],
                               "transcript_id": outcome[1]})
            elif deleting:
                self._store.delete(job_id)
                discard_owned_audio(job["audio_path"], self._recordings_dir)
            elif outcome[0] in ("cancelled", "interrupted"):
                self._store.update(job_id, status="waiting")
                if outcome[0] == "interrupted":
                    # Stopped from outside (logout, shutdown, task manager):
                    # don't start it or the next job again by ourselves.
                    self._paused = True
                    self._paused_by_recording = False
            else:
                _, error, code, language = outcome
                self._store.update(job_id, status="failed", error=error, error_code=code,
                                   error_language=language)
                self._store.move_to_end(job_id)
                events.append({"type": "job_failed", "job_id": job_id, "title": job["title"],
                               "error": error, "error_code": code, "error_language": language})
            if deleting:
                self._deleting.discard(job_id)
                self._delete_results[job_id] = outcome[0] != "done"
            self._running_id = None
            self._step = None
            self._cancel = None
            self._cond.notify_all()
        self._publish(*events)

    # ── Queue control ───────────────────────────────────────────────────────

    def start(self) -> None:
        with self._cond:
            self._paused = False
            self._paused_by_recording = False
            self._cond.notify_all()
        self._publish()

    def pause(self) -> None:
        with self._cond:
            self._pause()
            self._paused_by_recording = False
        self._publish()

    def _pause(self) -> None:
        self._paused = True
        if self._cancel is not None:
            self._cancel.set()
        self._cond.notify_all()

    def recording_started(self) -> None:
        with self._cond:
            self._recording = True
            if not self._paused:
                self._pause()
                self._paused_by_recording = True
        self._publish()

    def recording_stopped(self) -> None:
        with self._cond:
            self._recording = False
            if self._paused_by_recording:
                self._paused_by_recording = False
                if self._start_mode == "auto":
                    self._paused = False
                    self._cond.notify_all()
        self._publish()

    def set_start_mode(self, mode: str) -> None:
        if mode not in START_MODES:
            raise ValueError(f"start_mode must be one of {', '.join(START_MODES)}")
        with self._cond:
            self._store.set_setting("start_mode", mode)
            self._start_mode = mode
            self._cond.notify_all()
        self._publish()

    # ── Jobs ────────────────────────────────────────────────────────────────

    def add(self, audio_path: str, title: str, whisper_model: str, language: str | None) -> dict:
        with self._cond:
            job = self._store.add(audio_path=audio_path, title=title,
                                  whisper_model=whisper_model, language=language)
            self._cond.notify_all()
        self._publish()
        return job

    def update(self, job_id: str, **fields) -> dict:
        unknown = set(fields) - _EDITABLE
        if unknown:
            raise ValueError(f"Not editable: {', '.join(sorted(unknown))}")
        with self._cond:
            self._require(job_id)
            if job_id == self._running_id:
                raise JobRunning(job_id)
            self._store.update(job_id, **fields)
            job = self._store.get(job_id)
        self._publish()
        return job

    def retry(self, job_id: str) -> dict:
        with self._cond:
            if self._require(job_id)["status"] != "failed":
                raise JobNotFailed(job_id)
            self._store.update(job_id, status="waiting", error=None, error_code=None, error_language=None)
            self._store.move_to_end(job_id)
            job = self._store.get(job_id)
            self._cond.notify_all()
        self._publish()
        return job

    def reorder(self, job_ids: list[str]) -> None:
        with self._cond:
            self._store.reorder(job_ids)
        self._publish()

    def delete(self, job_id: str) -> bool:
        """Delete a job and its audio; a running job is stopped first.
        False if there is no such job (or it finished meanwhile)."""
        with self._cond:
            job = self._store.get(job_id)
            if job is None:
                return False
            if job_id == self._running_id:
                self._deleting.add(job_id)
                self._cancel.set()
                while self._running_id == job_id:
                    self._cond.wait()
                return self._delete_results.pop(job_id)
            self._store.delete(job_id)
            discard_owned_audio(job["audio_path"], self._recordings_dir)
        self._publish()
        return True

    def _require(self, job_id: str) -> dict:
        job = self._store.get(job_id)
        if job is None:
            raise JobNotFound(job_id)
        return job

    # ── State ───────────────────────────────────────────────────────────────

    def audio_paths(self) -> set[str]:
        return self._store.audio_paths()

    def is_running(self) -> bool:
        with self._cond:
            return self._running_id is not None

    @contextmanager
    def hold(self):
        """Keep the worker from starting a job (data reset). Raises QueueBusy
        if a job is running now."""
        with self._cond:
            if self._running_id is not None:
                raise QueueBusy()
            self._held += 1
        try:
            yield
        finally:
            with self._cond:
                self._held -= 1
                self._cond.notify_all()

    def clear(self) -> int:
        """Remove every job (their audio is left to the caller)."""
        with self._cond:
            removed = self._store.clear()
        self._publish()
        return removed

    def snapshot(self) -> dict:
        with self._cond:
            return {
                "type": "snapshot",
                "paused": self._paused,
                "paused_by_recording": self._paused_by_recording,
                "recording": self._recording,
                "start_mode": self._start_mode,
                "running_job_id": self._running_id,
                "step": self._step,
                "jobs": self._store.list(),
            }

    # ── Events ──────────────────────────────────────────────────────────────

    def subscribe(self, callback):
        """callback(event) gets job_done / job_failed events and a snapshot
        after every change, from whichever thread made it."""
        with self._cond:
            self._subscribers.append(callback)

        def unsubscribe():
            with self._cond:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)
        return unsubscribe

    def _publish(self, *events: dict) -> None:
        """Callbacks must be quick and must not block (they run under the
        publish lock)."""
        with self._publish_lock:
            snapshot = self.snapshot()
            with self._cond:
                subscribers = list(self._subscribers)
            for callback in subscribers:
                for event in (*events, snapshot):
                    try:
                        callback(event)
                    except Exception as exc:
                        log.warning(f"Queue subscriber failed: {exc}")
