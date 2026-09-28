"""TranscriptionQueue — pause/start, start mode, recording, retry, delete,
reorder. The pipeline is replaced by a Runner the test controls."""
import threading
import time

import pytest

from app.services.job_store import JobStore
from app.services.transcription_queue import (
    JobNotFailed, JobNotFound, JobRunning, QueueBusy, TranscriptionQueue,
)
from app.services.pipeline_process import PipelineInterrupted
from app.services.transcription_service import AlignmentModelMissingError
from queue_helpers import Runner, wait_for


@pytest.fixture
def env(tmp_path):
    recordings = tmp_path / "recordings"
    recordings.mkdir()
    store = JobStore(db_path=str(tmp_path / "db.sqlite"))
    runner = Runner()
    queues = []

    def make(**kw):
        q = TranscriptionQueue(store, runner, recordings_dir=recordings, **kw)
        q.start_worker()
        queues.append(q)
        return q

    yield make, store, runner, recordings
    for q in queues:
        q.stop_worker()


def _add(q, recordings, title, **kw):
    path = recordings / f"sonorus-import-{title}.wav"
    path.write_bytes(b"x")
    return q.add(audio_path=str(path), title=title, whisper_model=kw.get("model", "small"),
                 language=kw.get("language"))


def titles(q, status=None):
    return [j["title"] for j in q.snapshot()["jobs"] if status is None or j["status"] == status]


def idle(q):
    """Nothing running and nothing the worker could start now."""
    s = q.snapshot()
    return s["running_job_id"] is None and (s["paused"] or not titles(q, "waiting"))


# ── Initial state ─────────────────────────────────────────────────────────────

def test_a_new_queue_is_paused_with_auto_start_mode(env):
    make, *_ = env
    s = make().snapshot()
    assert s == {"type": "snapshot", "paused": True, "paused_by_recording": False, "recording": False,
                 "start_mode": "auto", "running_job_id": None, "step": None, "jobs": []}


def test_after_a_restart_the_queue_is_paused_and_an_interrupted_job_waits(env):
    make, store, runner, recordings = env
    job = store.add(audio_path="/rec/a.wav", title="a", whisper_model="small", language=None)
    store.update(job["id"], status="running")
    q = make()
    assert q.snapshot()["paused"] is True
    assert [j["status"] for j in q.snapshot()["jobs"]] == ["waiting"]
    time.sleep(0.1)
    assert runner.started == []


def test_start_runs_waiting_jobs_in_order_and_removes_finished_ones(env):
    make, store, runner, recordings = env
    q = make()
    events = []
    q.subscribe(events.append)
    _add(q, recordings, "a"), _add(q, recordings, "b")
    time.sleep(0.1)
    assert runner.started == []  # paused
    q.start()
    wait_for(lambda: len([e for e in events if e["type"] == "job_done"]) == 2)
    assert runner.started == ["a", "b"]
    done = [e for e in events if e["type"] == "job_done"]
    assert [(e["title"], e["transcript_id"]) for e in done] == [("a", 101), ("b", 102)]
    assert store.list() == []


def test_a_finished_job_keeps_its_audio(env):
    make, _, _, recordings = env
    q = make()
    job = _add(q, recordings, "a")
    q.start()
    wait_for(lambda: q.snapshot()["jobs"] == [])
    assert (recordings / "sonorus-import-a.wav").exists()
    assert job["audio_path"].endswith("sonorus-import-a.wav")


# ── Start mode ────────────────────────────────────────────────────────────────

def test_auto_an_empty_running_queue_picks_up_new_jobs(env):
    make, _, runner, recordings = env
    q = make()
    q.start()
    time.sleep(0.05)
    assert q.snapshot()["paused"] is False
    _add(q, recordings, "a")
    wait_for(lambda: runner.started == ["a"] and idle(q))
    assert q.snapshot()["paused"] is False


def test_auto_a_paused_queue_stays_paused_when_a_job_is_added(env):
    make, _, runner, recordings = env
    q = make()
    q.start()
    q.pause()
    _add(q, recordings, "a")
    time.sleep(0.1)
    assert runner.started == [] and q.snapshot()["paused"] is True


def test_manual_runs_everything_waiting_then_pauses_itself(env):
    make, _, runner, recordings = env
    q = make()
    q.set_start_mode("manual")
    _add(q, recordings, "a"), _add(q, recordings, "b")
    q.start()
    wait_for(lambda: q.snapshot()["paused"])
    assert runner.started == ["a", "b"]
    _add(q, recordings, "c")
    time.sleep(0.1)
    assert runner.started == ["a", "b"]


def test_manual_a_job_added_while_running_is_picked_up(env):
    make, _, runner, recordings = env
    q = make()
    q.set_start_mode("manual")
    runner.hold("a")
    _add(q, recordings, "a")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    _add(q, recordings, "b")
    runner.release("a")
    wait_for(lambda: q.snapshot()["paused"])
    assert runner.started == ["a", "b"]


def test_manual_start_with_nothing_waiting_pauses_again(env):
    make, *_ = env
    q = make()
    q.set_start_mode("manual")
    q.start()
    wait_for(lambda: q.snapshot()["paused"])


def test_switching_to_manual_pauses_an_idle_running_queue(env):
    make, *_ = env
    q = make()
    q.start()
    time.sleep(0.05)
    q.set_start_mode("manual")
    wait_for(lambda: q.snapshot()["paused"])
    assert q.snapshot()["start_mode"] == "manual"


def test_start_mode_is_stored(env, tmp_path):
    make, store, runner, recordings = env
    make().set_start_mode("manual")
    q2 = TranscriptionQueue(store, runner, recordings_dir=recordings)
    assert q2.snapshot()["start_mode"] == "manual"


def test_unknown_start_mode_is_rejected(env):
    make, *_ = env
    with pytest.raises(ValueError):
        make().set_start_mode("sometimes")


# ── Pause ─────────────────────────────────────────────────────────────────────

def test_pause_interrupts_the_running_job_which_runs_again_from_the_start(env):
    make, _, runner, recordings = env
    q = make()
    runner.hold("a")
    _add(q, recordings, "a"), _add(q, recordings, "b")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    q.pause()
    wait_for(lambda: idle(q))
    assert runner.cancelled == ["a"]
    assert [(j["title"], j["status"]) for j in q.snapshot()["jobs"]] == [("a", "waiting"), ("b", "waiting")]
    runner.release("a")
    q.start()
    wait_for(lambda: q.snapshot()["jobs"] == [])
    assert runner.started == ["a", "a", "b"]


def test_snapshot_shows_the_running_job_and_its_step(env):
    make, _, runner, recordings = env
    q = make()
    runner.hold("a")
    job = _add(q, recordings, "a")
    q.start()
    wait_for(lambda: q.snapshot()["step"] == "Transcribing audio…")
    s = q.snapshot()
    assert s["running_job_id"] == job["id"]
    assert s["jobs"][0]["status"] == "running"
    assert q.is_running() is True
    runner.release("a")
    wait_for(lambda: idle(q))
    assert q.is_running() is False and q.snapshot()["step"] is None


# ── Failures and retry ────────────────────────────────────────────────────────

def test_a_failed_job_moves_to_the_end_and_the_queue_goes_on(env):
    make, _, runner, recordings = env
    q = make()
    events = []
    q.subscribe(events.append)
    runner.outcomes["a"] = RuntimeError("CUDA out of memory")
    _add(q, recordings, "a"), _add(q, recordings, "b"), _add(q, recordings, "c")
    q.start()
    wait_for(lambda: titles(q) == ["a"] and idle(q) and any(e["type"] == "job_failed" for e in events))
    [failed] = q.snapshot()["jobs"]
    assert failed["status"] == "failed" and failed["error"] == "CUDA out of memory"
    assert runner.started == ["a", "b", "c"]  # a is not retried by itself
    [ev] = [e for e in events if e["type"] == "job_failed"]
    assert (ev["title"], ev["error"], ev["error_code"]) == ("a", "CUDA out of memory", None)


def test_failed_jobs_are_skipped_and_sit_after_waiting_ones(env):
    make, _, runner, recordings = env
    q = make()
    runner.outcomes["a"] = RuntimeError("boom")
    runner.hold("b")
    _add(q, recordings, "a"), _add(q, recordings, "b")
    q.start()
    wait_for(lambda: runner.started == ["a", "b"])
    q.pause()
    _add(q, recordings, "c")
    assert titles(q) == ["b", "a", "c"]
    runner.release("b")
    q.start()
    wait_for(lambda: titles(q) == ["a"] and idle(q))
    assert runner.started == ["a", "b", "b", "c"]


def test_missing_alignment_model_is_a_structured_failure(env):
    make, _, runner, recordings = env
    q = make()
    runner.outcomes["a"] = AlignmentModelMissingError("de")
    _add(q, recordings, "a")
    q.start()
    wait_for(lambda: titles(q, "failed") == ["a"])
    job = q.snapshot()["jobs"][0]
    assert (job["error_code"], job["error_language"]) == ("alignment_model_missing", "de")


def test_retry_puts_a_failed_job_back_at_the_end(env):
    make, _, runner, recordings = env
    q = make()
    runner.outcomes["a"] = RuntimeError("boom")
    a = _add(q, recordings, "a")
    q.start()
    wait_for(lambda: titles(q, "failed") == ["a"])
    q.pause()
    b = _add(q, recordings, "b")
    q.retry(a["id"])
    jobs = q.snapshot()["jobs"]
    assert [(j["title"], j["status"]) for j in jobs] == [("b", "waiting"), ("a", "waiting")]
    assert jobs[1]["error"] is None and jobs[1]["error_code"] is None
    runner.outcomes["a"] = 7
    q.start()
    wait_for(lambda: q.snapshot()["jobs"] == [])
    assert runner.started == ["a", "b", "a"]


def test_retry_needs_a_failed_job(env):
    make, _, _, recordings = env
    q = make()
    job = _add(q, recordings, "a")
    with pytest.raises(JobNotFailed):
        q.retry(job["id"])
    with pytest.raises(JobNotFound):
        q.retry("nope")


# ── Delete ────────────────────────────────────────────────────────────────────

def test_delete_a_waiting_job_removes_it_and_its_audio(env):
    make, store, _, recordings = env
    q = make()
    a, b = _add(q, recordings, "a"), _add(q, recordings, "b")
    assert q.delete(a["id"]) is True
    assert titles(q) == ["b"]
    assert not (recordings / "sonorus-import-a.wav").exists()
    assert (recordings / "sonorus-import-b.wav").exists()


def test_delete_removes_a_live_recording_too(env):
    make, _, _, recordings = env
    q = make()
    rec = recordings / "sonorus-rec-1.webm"
    rec.write_bytes(b"x")
    job = q.add(audio_path=str(rec), title="rec", whisper_model="small", language=None)
    q.delete(job["id"])
    assert not rec.exists()


def test_delete_never_touches_audio_outside_the_recordings_dir(env, tmp_path):
    make, *_ = env
    q = make()
    original = tmp_path / "meeting.wav"
    original.write_bytes(b"x")
    job = q.add(audio_path=str(original), title="m", whisper_model="small", language=None)
    q.delete(job["id"])
    assert original.exists()


def test_delete_a_running_job_stops_it_and_the_queue_goes_on(env):
    make, _, runner, recordings = env
    q = make()
    runner.hold("a")
    a = _add(q, recordings, "a")
    _add(q, recordings, "b")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    assert q.delete(a["id"]) is True
    assert runner.cancelled == ["a"]
    assert not (recordings / "sonorus-import-a.wav").exists()
    wait_for(lambda: q.snapshot()["jobs"] == [])
    assert runner.started == ["a", "b"]


def test_delete_unknown_job(env):
    make, *_ = env
    assert make().delete("nope") is False


# ── Edit and reorder ──────────────────────────────────────────────────────────

def test_update_a_waiting_job(env):
    make, _, _, recordings = env
    q = make()
    job = _add(q, recordings, "a", language="ru")
    q.update(job["id"], title="Sync", whisper_model="large-v3", language=None)
    got = q.snapshot()["jobs"][0]
    assert (got["title"], got["whisper_model"], got["language"]) == ("Sync", "large-v3", None)


def test_update_a_failed_job(env):
    make, _, runner, recordings = env
    q = make()
    runner.outcomes["a"] = RuntimeError("boom")
    job = _add(q, recordings, "a")
    q.start()
    wait_for(lambda: titles(q, "failed") == ["a"])
    q.update(job["id"], whisper_model="small")
    assert q.snapshot()["jobs"][0]["status"] == "failed"


def test_update_the_running_job_is_refused(env):
    make, _, runner, recordings = env
    q = make()
    runner.hold("a")
    job = _add(q, recordings, "a")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    with pytest.raises(JobRunning):
        q.update(job["id"], title="x")
    with pytest.raises(JobNotFound):
        q.update("nope", title="x")
    runner.release("a")


def test_reorder_changes_what_runs_next(env):
    make, _, runner, recordings = env
    q = make()
    a, b, c = (_add(q, recordings, t) for t in "abc")
    q.reorder([c["id"], a["id"], b["id"]])
    assert titles(q) == ["c", "a", "b"]
    q.start()
    wait_for(lambda: q.snapshot()["jobs"] == [])
    assert runner.started == ["c", "a", "b"]
    with pytest.raises(ValueError):
        q.reorder(["nope"])


# ── Live recording ────────────────────────────────────────────────────────────

def test_recording_pauses_and_interrupts_then_auto_resumes(env):
    make, _, runner, recordings = env
    q = make()
    runner.hold("a")
    _add(q, recordings, "a")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    q.recording_started()
    wait_for(lambda: idle(q))
    s = q.snapshot()
    assert (s["paused"], s["paused_by_recording"], s["recording"]) == (True, True, True)
    assert runner.cancelled == ["a"]
    _add(q, recordings, "dropped")  # imports are allowed while recording
    _add(q, recordings, "rec")      # the new recording goes to the end
    time.sleep(0.05)
    assert runner.started == ["a"]
    runner.release("a")
    q.recording_stopped()
    s = q.snapshot()
    assert (s["paused"], s["paused_by_recording"], s["recording"]) == (False, False, False)
    wait_for(lambda: q.snapshot()["jobs"] == [])
    assert runner.started == ["a", "a", "dropped", "rec"]


def test_recording_while_already_paused_does_not_resume_afterwards(env):
    make, _, runner, recordings = env
    q = make()
    q.start()
    q.pause()
    q.recording_started()
    assert q.snapshot()["paused_by_recording"] is False
    q.recording_stopped()
    _add(q, recordings, "a")
    time.sleep(0.05)
    assert q.snapshot()["paused"] is True and runner.started == []


def test_user_pause_during_recording_stays_after_it(env):
    make, *_ = env
    q = make()
    q.start()
    q.recording_started()
    q.pause()
    q.recording_stopped()
    assert q.snapshot()["paused"] is True


def test_manual_mode_does_not_resume_after_a_recording(env):
    make, _, runner, recordings = env
    q = make()
    q.set_start_mode("manual")
    runner.hold("a")
    _add(q, recordings, "a")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    q.recording_started()
    q.recording_stopped()
    time.sleep(0.05)
    assert q.snapshot()["paused"] is True
    runner.release("a")


def test_start_during_a_recording_is_the_users_choice(env):
    make, _, runner, recordings = env
    q = make()
    q.start()
    q.recording_started()
    q.start()
    _add(q, recordings, "a")
    wait_for(lambda: runner.started == ["a"])
    q.recording_stopped()
    assert q.snapshot()["paused"] is False


# ── Busy state, reset, events, shutdown ───────────────────────────────────────

def test_hold_refuses_while_a_job_runs_and_blocks_new_starts(env):
    make, _, runner, recordings = env
    q = make()
    runner.hold("a")
    _add(q, recordings, "a")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    with pytest.raises(QueueBusy):
        with q.hold():
            pass
    runner.release("a")
    wait_for(lambda: idle(q))
    with q.hold():
        _add(q, recordings, "b")
        time.sleep(0.1)
        assert runner.started == ["a"]
        assert q.clear() == 1
    assert q.snapshot()["jobs"] == []


def test_subscribers_get_a_snapshot_on_every_change(env):
    make, _, _, recordings = env
    q = make()
    events = []
    unsubscribe = q.subscribe(events.append)
    job = _add(q, recordings, "a")
    assert events[-1]["type"] == "snapshot" and events[-1]["jobs"][0]["id"] == job["id"]
    q.start()
    assert events[-1]["paused"] is False
    unsubscribe()
    count = len(events)
    q.pause()
    assert len(events) == count


def test_stop_worker_interrupts_the_running_job_and_keeps_it(env):
    make, store, runner, recordings = env
    q = make()
    runner.hold("a")
    _add(q, recordings, "a")
    q.start()
    wait_for(lambda: runner.started == ["a"])
    q.stop_worker()
    assert runner.cancelled == ["a"]
    assert [j["status"] for j in store.list()] == ["waiting"]


def test_snapshots_reach_a_subscriber_in_order(env):
    """Worker and API threads publish at the same time; the last snapshot a
    subscriber gets must be the current state."""
    make, _, runner, recordings = env
    q = make()
    last = []
    q.subscribe(lambda e: e["type"] == "snapshot" and last.append(e))
    q.start()

    def churn(n):
        for i in range(20):
            _add(q, recordings, f"{n}-{i}")

    threads = [threading.Thread(target=churn, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wait_for(lambda: q.snapshot()["jobs"] == [] and idle(q))
    time.sleep(0.05)
    assert last[-1]["jobs"] == [] and last[-1]["running_job_id"] is None


def test_a_job_that_errors_while_the_backend_stops_waits_instead_of_failing(env):
    """On shutdown the child may die before it is cancelled (exit code -15):
    that is an interruption, not a failed job."""
    make, store, runner, recordings = env
    q = make()
    gate = threading.Event()

    def dies_on_shutdown(job, on_progress, cancel_event):
        gate.set()
        cancel_event.wait(5)
        raise RuntimeError("Transcription process exited unexpectedly (code -15)")

    q._run_job = dies_on_shutdown
    _add(q, recordings, "a")
    q.start()
    assert gate.wait(5)
    q.stop_worker()
    assert [(j["status"], j["error"]) for j in store.list()] == [("waiting", None)]


def test_a_job_interrupted_from_outside_waits_and_the_queue_pauses(env):
    make, _, runner, recordings = env
    q = make()
    events = []
    q.subscribe(events.append)
    runner.outcomes["a"] = PipelineInterrupted()
    _add(q, recordings, "a"), _add(q, recordings, "b")
    q.start()
    wait_for(lambda: q.snapshot()["paused"] and idle(q))
    assert [(j["title"], j["status"], j["error"]) for j in q.snapshot()["jobs"]] == \
        [("a", "waiting", None), ("b", "waiting", None)]
    assert runner.started == ["a"]
    assert not any(e["type"] == "job_failed" for e in events)
