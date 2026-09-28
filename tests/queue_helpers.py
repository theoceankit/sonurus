"""Shared helpers for transcription queue tests."""
import threading
import time

from app.services.pipeline_process import PipelineCancelled


class Runner:
    """Stand-in for the pipeline. A job whose title is in `gates` runs until
    its gate is set (or it is cancelled); `outcomes[title]` is the transcript
    id to return or an exception to raise."""

    def __init__(self):
        self.started = []            # titles, in the order jobs started
        self.gates = {}              # title → Event
        self.outcomes = {}           # title → int | Exception
        self.cancelled = []          # titles whose run was cancelled

    def __call__(self, job, on_progress, cancel_event):
        self.started.append(job["title"])
        on_progress("Transcribing audio…")
        gate = self.gates.get(job["title"])
        while gate is not None and not gate.is_set():
            if cancel_event.wait(0.01):
                break
        if cancel_event.is_set():
            self.cancelled.append(job["title"])
            raise PipelineCancelled()
        out = self.outcomes.get(job["title"], 100 + len(self.started))
        if isinstance(out, BaseException):
            raise out
        return out

    def hold(self, *titles):
        for t in titles:
            self.gates[t] = threading.Event()

    def release(self, title):
        self.gates[title].set()


def wait_for(pred, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return
        time.sleep(0.01)
    raise AssertionError("condition not reached")
