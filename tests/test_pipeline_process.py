"""The transcription pipeline runs in a child process so a job can be stopped
at once, on any step, and its GPU memory is freed when the process exits."""
import os
import pickle
import threading
import time
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

import pipeline_workers
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services import pipeline_process
from app.services.pipeline_process import (
    PipelineCancelled, PipelineInterrupted, _pipeline_worker, run_pipeline_process,
)
from app.services.transcription_service import AlignmentModelMissingError

ARGS = {"audio_path": "/rec/a.wav", "whisper_model": "small", "language": None, "db_path": "/data/x.db"}


def _run(worker, on_progress=None, cancel_event=None):
    return run_pipeline_process(ARGS, on_progress or (lambda step: None),
                                cancel_event or threading.Event(), worker=worker)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A killed child stays a zombie until reaped; join() in the runner reaps it.
    with open(f"/proc/{pid}/stat") as f:
        return f.read().split()[2] != "Z"


# ── Subprocess machinery (stand-in workers) ────────────────────────────────────

def test_progress_is_relayed_in_order_and_the_result_returned():
    steps = []
    result = _run(pipeline_workers.ok_worker, on_progress=steps.append)
    assert steps == ["Transcribing audio…", "Identifying speakers…"]
    assert result == {"audio_path": "/rec/a.wav", "segments": [1, 2, 3]}


def test_cancel_mid_step_stops_the_child_at_once():
    cancel = threading.Event()
    pids = []

    def on_progress(step):
        pids.append(int(step.split()[1]))
        cancel.set()  # user pauses while the long step runs

    started = time.monotonic()
    with pytest.raises(PipelineCancelled):
        _run(pipeline_workers.pid_worker, on_progress=on_progress, cancel_event=cancel)
    assert time.monotonic() - started < 5
    assert not _alive(pids[0])


def test_cancel_set_while_the_child_is_silent():
    cancel = threading.Event()
    threading.Timer(0.5, cancel.set).start()
    started = time.monotonic()
    with pytest.raises(PipelineCancelled):
        _run(pipeline_workers.slow_worker, cancel_event=cancel)
    assert time.monotonic() - started < 5


def test_already_cancelled_starts_no_child():
    cancel = threading.Event()
    cancel.set()
    with patch.object(pipeline_process.multiprocessing, "get_context") as get_context:
        with pytest.raises(PipelineCancelled):
            _run(pipeline_workers.ok_worker, cancel_event=cancel)
    get_context.assert_not_called()


def test_on_progress_raising_stops_the_child_and_propagates():
    pids = []

    def on_progress(step):
        pids.append(int(step.split()[1]))
        raise KeyError("boom")

    with pytest.raises(KeyError):
        _run(pipeline_workers.pid_worker, on_progress=on_progress)
    assert not _alive(pids[0])


def test_child_error_is_raised_with_its_message():
    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        _run(pipeline_workers.failing_worker)


def test_missing_alignment_model_is_raised_with_its_language():
    with pytest.raises(AlignmentModelMissingError) as exc:
        _run(pipeline_workers.alignment_missing_worker)
    assert exc.value.language == "de"


@pytest.mark.skipif(os.name != "posix", reason="signals are POSIX")
def test_child_terminated_from_outside_is_an_interruption_not_an_error():
    """SIGTERM/SIGINT/SIGHUP (logout, shutdown, a task manager) stop the job;
    only other deaths (e.g. the OOM killer's SIGKILL) are errors."""
    with pytest.raises(PipelineInterrupted):
        _run(pipeline_workers.terminated_worker)


def test_child_dying_without_a_result_is_an_error():
    with pytest.raises(RuntimeError, match="exited unexpectedly.*3"):
        _run(pipeline_workers.crashing_worker)


# ── The real worker, called in-process with a fake connection ─────────────────

class _Conn:
    def __init__(self):
        self.sent = []

    def send(self, msg):
        self.sent.append(msg)


def test_worker_runs_the_pipeline_and_sends_progress_then_the_transcript():
    transcript = Transcript(audio_path="/rec/a.wav")

    def run_pipeline(audio_path, on_progress, language=None):
        on_progress("Transcribing audio…")
        return transcript

    controller = MagicMock()
    controller.run_pipeline.side_effect = run_pipeline
    conn = _Conn()
    with patch("app.services.service_factory.create_controller",
               return_value=(controller, MagicMock())) as create:
        _pipeline_worker({**ARGS, "language": "en"}, conn)

    create.assert_called_once_with(db_path="/data/x.db", whisper_model="small")
    controller.run_pipeline.assert_called_once()
    assert controller.run_pipeline.call_args.args[0] == "/rec/a.wav"
    assert controller.run_pipeline.call_args.kwargs["language"] == "en"
    assert conn.sent == [("progress", "Transcribing audio…"), ("done", transcript)]


def test_worker_reports_a_missing_alignment_model():
    controller = MagicMock()
    controller.run_pipeline.side_effect = AlignmentModelMissingError("ja")
    conn = _Conn()
    with patch("app.services.service_factory.create_controller", return_value=(controller, MagicMock())):
        _pipeline_worker(ARGS, conn)
    assert conn.sent == [("alignment_missing", "ja")]


def test_worker_reports_any_other_error():
    conn = _Conn()
    with patch("app.services.service_factory.create_controller", side_effect=RuntimeError("bad HF token")):
        _pipeline_worker(ARGS, conn)
    assert conn.sent == [("error", "RuntimeError", "bad HF token")]


def test_transcript_with_embeddings_survives_the_trip_between_processes():
    emb = np.arange(4, dtype=np.float32)
    t = Transcript(segments=[Segment(0.0, 1.5, "hi", "SPEAKER_00", speaker_resolved="u1", embedding=emb)],
                   audio_path="/rec/a.wav", language="en")
    back = pickle.loads(pickle.dumps(t))
    assert back.segments[0].text == "hi" and back.segments[0].speaker_resolved == "u1"
    assert np.array_equal(back.segments[0].embedding, emb)


# ── The child's lifetime belongs to the backend ───────────────────────────────

posix_only = pytest.mark.skipif(os.name != "posix", reason="process groups and signals are POSIX")


@posix_only
def test_signals_to_the_backends_process_group_do_not_reach_the_child():
    """Ctrl+C in a terminal (or a group SIGTERM) must go through the backend's
    shutdown, which puts the running job back into the queue — the child
    dying on its own would fail the job instead."""
    import signal
    cancel = threading.Event()
    pids = []

    def on_progress(step):
        pids.append(int(step.split()[1]))
        child = pids[0]
        assert os.getpgid(child) != os.getpgid(0)
        os.kill(child, signal.SIGINT)
        time.sleep(0.3)
        assert _alive(child), "SIGINT must be ignored by the child"
        cancel.set()

    with pytest.raises(PipelineCancelled):
        _run(pipeline_workers.pid_worker, on_progress=on_progress, cancel_event=cancel)
    assert not _alive(pids[0])


@posix_only
def test_the_child_exits_when_the_backend_dies():
    """A killed backend (SIGKILL, crash) must not leave a child holding the GPU."""
    import multiprocessing
    import signal
    ctx = multiprocessing.get_context("spawn")
    report = ctx.Queue()
    middle = ctx.Process(target=pipeline_workers.run_and_report, args=(report,))
    middle.start()
    child = report.get(timeout=30)
    assert _alive(child)
    os.kill(middle.pid, signal.SIGKILL)
    middle.join()
    deadline = time.monotonic() + 5
    while _alive_or_zombie_gone(child) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _alive_or_zombie_gone(child)


def _alive_or_zombie_gone(pid: int) -> bool:
    """True while pid runs; an orphan is reaped by init, so no zombie check."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().split()[2] != "Z"
    except FileNotFoundError:
        return False
