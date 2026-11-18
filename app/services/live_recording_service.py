"""The live recording, owned by the backend from start to the queue.

A recording takes the microphone, system audio or both, one capture process
per track (AudioCaptureService). Nothing of it lives in a window: a window
starts and stops it and shows it from the queue snapshot, so the window can be
closed and opened again while it runs.

    start   → the queue pauses (TranscriptionQueue.recording_started), each
              track starts; one that cannot start lets go of everything
    live    → a watcher checks the capture processes; one that ended by
              itself lost its source: the recording stops as if by Stop.
              It also reads the tracks: when none was loud for
              silence_after seconds, a call_ended event (reason silence)
              says the call may have ended, once until a track is loud
              again; the recording goes on
    stop    → answers at once; on its own thread the tracks stop together and
              become one file in recordings/, the file is queued with the
              title, model and language it was started with, and the queue
              is let go last (recording_stopped), so the recording goes to
              the end of the queue

Phases in the snapshot: starting → live → stopping → none. A failure after
the start is a recording_failed event, a lost source a recording_source_lost
event; a saved recording whose system track held zeros only where that may be
a refused permission (macOS) a recording_system_silent event. They go out over
WS /ws/queue with the snapshot that ends the recording.
"""
import threading
import time
from dataclasses import dataclass

from app.logger import get_logger
from app.services.track_silence import SilenceWatch

log = get_logger("LiveRecording")


class RecordingBusy(Exception):
    """A recording is already in progress."""


class NotRecording(Exception):
    """No live recording to stop."""


@dataclass
class RecordingRequest:
    mic: bool
    # None: the default microphone / system audio source.
    mic_device: str | None
    system: bool
    system_source: str | None
    title: str
    whisper_model: str
    language: str | None


# A recording with no sound on any track this long may be a call that ended.
SILENCE_AFTER_SEC = 300.0
SILENCE_CHECK_SEC = 2.0


class LiveRecordingService:
    def __init__(self, capture, queue, poll_interval: float = 0.5,
                 silence_after: float = SILENCE_AFTER_SEC, silence_check: float = SILENCE_CHECK_SEC):
        self._capture = capture
        self._queue = queue
        self._poll = poll_interval
        self._silence_after = silence_after
        self._silence_check = silence_check
        self._lock = threading.Lock()
        self._state: dict | None = None
        self._request: RecordingRequest | None = None
        # kind ("mic" / "system") → capture job id
        self._jobs: dict[str, str] = {}
        self._wake = threading.Event()

    def is_recording(self) -> bool:
        """From the start until the recording is queued (or failed) and its
        events and closing snapshot are out."""
        with self._lock:
            return self._state is not None

    def state(self) -> dict | None:
        with self._lock:
            return dict(self._state) if self._state else None

    def start(self, request: RecordingRequest) -> dict:
        """Start recording; returns the live state. Raises RecordingBusy,
        ValueError (no source) or RuntimeError (a track could not start, with
        a reason for the user)."""
        sources = [kind for kind, on in (("mic", request.mic), ("system", request.system)) if on]
        if not sources:
            raise ValueError("Turn on the microphone or system audio to record.")
        with self._lock:
            if self._state is not None:
                raise RecordingBusy()
            self._state = {"phase": "starting", "title": request.title,
                           "started_at": None, "sources": sources}
            self._request = request
            self._jobs = {}
            starting = dict(self._state)
        self._queue.recording_started(starting)
        try:
            if request.mic:
                self._jobs["mic"] = self._capture.start_capture(request.mic_device, kind="mic")
            if request.system:
                self._jobs["system"] = self._capture.start_capture(request.system_source)
        except Exception:
            for job_id in self._jobs.values():
                self._capture.discard(job_id)
            self._let_go()
            raise
        with self._lock:
            # The time counts from the first track: nothing is recorded before it.
            started_at = min(self._capture.started_at(j) for j in self._jobs.values())
            self._state = {**self._state, "phase": "live", "started_at": started_at}
            live = dict(self._state)
            jobs = dict(self._jobs)
        self._queue.recording_updated(live)
        self._wake.clear()
        threading.Thread(target=self._watch, args=(jobs,), name="recording-watch", daemon=True).start()
        return live

    def stop(self) -> dict:
        """Stop the live recording; answers at once, the file is made and
        queued on a thread of its own. Raises NotRecording."""
        stopping = self._begin_stop()
        if stopping is None:
            raise NotRecording()
        threading.Thread(target=self._finish, name="recording-stop", daemon=True).start()
        return stopping

    def shutdown(self) -> None:
        """The backend goes down: the captures are let go, nothing is saved."""
        self._wake.set()
        with self._lock:
            jobs = list(self._jobs.values())
            self._state, self._request, self._jobs = None, None, {}
        for job_id in jobs:
            self._capture.discard(job_id)

    # ── Internals ───────────────────────────────────────────────────────────

    def _begin_stop(self) -> dict | None:
        """live → stopping, once; None if there is no live recording."""
        with self._lock:
            if self._state is None or self._state["phase"] != "live":
                return None
            self._state = {**self._state, "phase": "stopping"}
            stopping = dict(self._state)
        self._wake.set()
        self._queue.recording_updated(stopping)
        return stopping

    def _watch(self, jobs: dict[str, str]) -> None:
        silence = SilenceWatch([self._capture.track_path(j) for j in jobs.values()], after=self._silence_after)
        told = False
        next_check = time.monotonic() + self._silence_check
        while not self._wake.wait(self._poll):
            lost = next((kind for kind, job_id in jobs.items() if not self._capture.alive(job_id)), None)
            if lost is None:
                if time.monotonic() >= next_check:
                    next_check = time.monotonic() + self._silence_check
                    silent = silence.check()
                    if silent and not told:
                        self._queue.notify({"type": "call_ended", "reason": "silence"})
                    told = silent
                continue
            if self._begin_stop() is not None:
                log.warning(f"The {lost} capture ended by itself; stopping the recording")
                self._finish(lost=lost)
            return

    def _finish(self, lost: str | None = None) -> None:
        with self._lock:
            request, jobs = self._request, dict(self._jobs)
        events = []
        try:
            # Read before the stop, which removes the track.
            silent = "system" in jobs and self._capture.only_silence(jobs["system"])
            path = self._capture.stop_recording(system_job=jobs.get("system"), mic_job=jobs.get("mic"))
            self._queue.add(audio_path=path, title=request.title,
                            whisper_model=request.whisper_model, language=request.language)
            if lost:
                events.append({"type": "recording_source_lost", "source": lost, "title": request.title})
            if silent:
                events.append({"type": "recording_system_silent", "title": request.title})
        except Exception as exc:
            log.exception("The recording could not be saved")
            events.append({"type": "recording_failed", "title": request.title, "error": str(exc)})
        finally:
            # Last: the recording is queued before the queue may run again.
            self._let_go(*events)

    def _let_go(self, *events: dict) -> None:
        """The queue is let go and the events go out with the closing snapshot
        before the recording is over: whoever waits for is_recording() to turn
        False finds them out, and a new start cannot slip in before the old
        recording has let go of the queue."""
        try:
            self._queue.recording_stopped(*events)
        finally:
            with self._lock:
                self._state, self._request, self._jobs = None, None, {}
