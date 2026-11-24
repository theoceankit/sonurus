"""LiveRecordingService: the backend owns a live recording from start to queue.

The capture side is a fake (no processes, no ffmpeg); the queue is real, on a
temporary database, with its worker not running.
"""
import threading
import time

import pytest

from app.services.job_store import JobStore
from app.services.live_recording_service import (
    LiveRecordingService, NotRecording, RecordingBusy, RecordingRequest,
)
from app.services.transcription_queue import TranscriptionQueue
from capture_fakes import FakeCapture


@pytest.fixture
def queue(tmp_path):
    q = TranscriptionQueue(JobStore(db_path=str(tmp_path / "jobs.db")), run_job=lambda *a: 1,
                           recordings_dir=tmp_path)
    events = []
    q.subscribe(events.append)
    q.events = events
    return q


@pytest.fixture
def capture(tmp_path):
    return FakeCapture(tmp_path)


@pytest.fixture
def service(capture, queue):
    svc = LiveRecordingService(capture, queue, poll_interval=0.01)
    yield svc
    svc.shutdown()


def _request(mic=True, system=True, **kw):
    fields = dict(mic=mic, mic_device=None, system=system, system_source=None,
                  title="Standup", whisper_model="small", language="en")
    fields.update(kw)
    return RecordingRequest(**fields)


def _wait_idle(service, timeout=5):
    deadline = time.time() + timeout
    while service.is_recording() and time.time() < deadline:
        time.sleep(0.01)
    assert not service.is_recording(), "the recording did not finish"


def _types(queue):
    return [e["type"] for e in queue.events if e["type"] != "snapshot"]


# ── Starting ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mic, system, kinds", [
    (True, True, {"mic", "system"}), (True, False, {"mic"}), (False, True, {"system"}),
])
def test_start_captures_the_chosen_sources_and_is_live_in_the_queue_snapshot(
        service, capture, queue, mic, system, kinds):
    state = service.start(_request(mic=mic, system=system, mic_device="alsa_input.x", system_source="x.monitor"))
    assert {j["kind"] for j in capture.jobs.values()} == kinds
    for job in capture.jobs.values():
        assert job["source"] == ("alsa_input.x" if job["kind"] == "mic" else "x.monitor")
    assert state["phase"] == "live"
    snapshot = queue.snapshot()
    assert snapshot["recording"] == state
    assert snapshot["recording"]["title"] == "Standup"
    assert sorted(snapshot["recording"]["sources"]) == sorted(kinds)
    assert service.is_recording()


def test_the_recording_counts_from_its_first_track(service, capture):
    state = service.start(_request())
    assert state["started_at"] == min(j["started_at"] for j in capture.jobs.values())


def test_start_pauses_the_running_queue_for_the_recording(service, queue):
    service.start(_request())
    snapshot = queue.snapshot()
    assert (snapshot["paused"], snapshot["paused_by_recording"]) == (True, True)


def test_start_shows_starting_before_live(service, queue):
    service.start(_request())
    phases = [e["recording"]["phase"] for e in queue.events
              if e["type"] == "snapshot" and e["recording"]]
    assert phases[0] == "starting"
    assert phases[-1] == "live"


def test_start_without_a_source_is_refused(service, queue):
    with pytest.raises(ValueError):
        service.start(_request(mic=False, system=False))
    assert queue.snapshot()["recording"] is None


def test_a_second_start_is_refused_while_recording(service):
    service.start(_request())
    with pytest.raises(RecordingBusy):
        service.start(_request())


@pytest.mark.parametrize("failing", ["mic", "system"])
def test_a_source_that_cannot_start_lets_go_of_the_other_and_of_the_queue(service, capture, queue, failing):
    capture.fail_start[failing] = RuntimeError(f"{failing} is busy")
    with pytest.raises(RuntimeError, match=f"{failing} is busy"):
        service.start(_request())
    assert capture.jobs == {}
    snapshot = queue.snapshot()
    assert snapshot["recording"] is None
    assert (snapshot["paused"], snapshot["paused_by_recording"]) == (False, False)
    assert not service.is_recording()


# ── Stopping ─────────────────────────────────────────────────────────────────

def test_stop_answers_at_once_and_queues_the_recording_with_its_settings(service, capture, queue):
    service.start(_request(title="Weekly", whisper_model="medium", language="de"))
    jobs = dict(capture.jobs)
    state = service.stop()
    assert state["phase"] == "stopping"
    _wait_idle(service)
    system = next(j for j, v in jobs.items() if v["kind"] == "system")
    mic = next(j for j, v in jobs.items() if v["kind"] == "mic")
    assert capture.stopped == [(system, mic)]
    [job] = queue.snapshot()["jobs"]
    assert (job["title"], job["whisper_model"], job["language"]) == ("Weekly", "medium", "de")
    assert job["diarize"] is True
    assert job["audio_path"].endswith(f"sonorus-rec-{system}.wav")
    snapshot = queue.snapshot()
    assert snapshot["recording"] is None
    assert snapshot["paused_by_recording"] is False


def test_the_queue_resumes_only_after_the_recording_is_queued(service, queue):
    service.start(_request())
    service.stop()
    _wait_idle(service)
    after_job = [e for e in queue.events if e["type"] == "snapshot" and e["jobs"]]
    assert after_job[0]["recording"] is not None, "the job was queued after the queue was let go"
    assert queue.snapshot()["paused"] is False


def test_stop_without_a_live_recording_is_refused(service):
    with pytest.raises(NotRecording):
        service.stop()
    service.start(_request())
    service.stop()
    with pytest.raises(NotRecording):
        service.stop()


def test_a_failed_stop_tells_why_and_lets_go(service, capture, queue):
    capture.fail_stop = RuntimeError("No audio was captured from the microphone.")
    service.start(_request(mic=True, system=False))
    service.stop()
    _wait_idle(service)
    [failed] = [e for e in queue.events if e["type"] == "recording_failed"]
    assert failed["error"] == "No audio was captured from the microphone."
    assert failed["title"] == "Standup"
    assert queue.snapshot()["jobs"] == []
    assert queue.snapshot()["recording"] is None


@pytest.mark.parametrize("how", ["failed", "lost"])
def test_the_events_are_out_before_the_recording_is_over(service, capture, queue, monkeypatch, how):
    # A slow publish must not leave a gap where is_recording() is already
    # False but the event and the closing snapshot are not out yet.
    stopped = queue.recording_stopped

    def _slow(*events):
        time.sleep(0.2)
        stopped(*events)

    monkeypatch.setattr(queue, "recording_stopped", _slow)
    service.start(_request(system=False))
    if how == "failed":
        capture.fail_stop = RuntimeError("boom")
        service.stop()
    else:
        capture.lose("mic")
    _wait_idle(service)
    expected = "recording_failed" if how == "failed" else "recording_source_lost"
    assert expected in _types(queue)
    assert queue.events[-1]["type"] == "snapshot"
    assert queue.events[-1]["recording"] is None


def test_a_start_right_after_a_stop_is_not_let_go_by_the_old_recording(service, capture, queue, monkeypatch):
    stopped = queue.recording_stopped
    restarted = []

    def _start_in_between(*events):
        # The old recording is not over yet: a new one must wait for it.
        try:
            service.start(_request())
            restarted.append(True)
        except RecordingBusy:
            restarted.append(False)
        stopped(*events)

    monkeypatch.setattr(queue, "recording_stopped", _start_in_between)
    service.start(_request())
    service.stop()
    _wait_idle(service)
    assert restarted == [False]
    assert queue.snapshot()["recording"] is None


def test_a_recording_that_cannot_be_queued_tells_why(service, queue, monkeypatch):
    monkeypatch.setattr(queue, "add", lambda **kw: (_ for _ in ()).throw(OSError("disk full")))
    service.start(_request())
    service.stop()
    _wait_idle(service)
    assert "recording_failed" in _types(queue)
    assert queue.snapshot()["recording"] is None


# ── A source lost mid-recording ──────────────────────────────────────────────

@pytest.mark.parametrize("lost", ["mic", "system"])
def test_a_lost_source_stops_saves_and_queues_the_recording(service, capture, queue, lost):
    service.start(_request())
    capture.lose(lost)
    _wait_idle(service)
    assert len(capture.stopped) == 1
    assert len(queue.snapshot()["jobs"]) == 1
    [event] = [e for e in queue.events if e["type"] == "recording_source_lost"]
    assert event == {"type": "recording_source_lost", "source": lost, "title": "Standup"}


def test_nothing_is_reported_lost_after_a_stop(service, capture, queue):
    service.start(_request())
    service.stop()
    _wait_idle(service)
    capture.lose("mic")
    time.sleep(0.05)
    assert "recording_source_lost" not in _types(queue)


# ── The backend going down ───────────────────────────────────────────────────

def test_shutdown_lets_go_of_the_captures(service, capture, queue):
    service.start(_request())
    service.shutdown()
    assert capture.jobs == {}
    assert len(capture.discarded) == 2
    assert not service.is_recording()


def test_a_start_and_a_stop_from_two_threads_do_not_both_run(service, capture):
    service.start(_request())
    errors = []

    def _stop():
        try:
            service.stop()
        except NotRecording as exc:
            errors.append(exc)

    threads = [threading.Thread(target=_stop) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    _wait_idle(service)
    assert len(errors) == 3
    assert len(capture.stopped) == 1


def test_snapshots_and_events_match_the_models_the_ui_types_come_from(service, capture, queue):
    from app.api.schemas import QueueSnapshot, RecordingFailedEvent, RecordingSourceLostEvent
    service.start(_request())
    capture.lose("mic")
    _wait_idle(service)
    capture.fail_stop = RuntimeError("boom")
    service.start(_request())
    service.stop()
    _wait_idle(service)
    models = {"snapshot": QueueSnapshot, "recording_failed": RecordingFailedEvent,
              "recording_source_lost": RecordingSourceLostEvent}
    assert {"recording_failed", "recording_source_lost"} <= set(_types(queue))
    for event in queue.events:
        assert models[event["type"]].model_validate(event).model_dump() == event


# ── Silence ──────────────────────────────────────────────────────────────────

def _silent_wav(path, seconds=1):
    import struct
    rate = 48000
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    data = bytes(int(seconds * rate) * 2)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 0) + b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt
                + b"data" + struct.pack("<I", 0) + data)


def _wait_for(predicate, timeout=5):
    deadline = time.time() + timeout
    while not predicate() and time.time() < deadline:
        time.sleep(0.01)
    return predicate()


def test_quiet_tracks_for_the_while_say_the_call_may_have_ended(capture, queue):
    service = LiveRecordingService(capture, queue, poll_interval=0.01, silence_after=0.2, silence_check=0.01)
    try:
        service.start(_request())
        for job_id in capture.jobs:
            _silent_wav(capture.track_path(job_id))
        assert _wait_for(lambda: "call_ended" in _types(queue))
        ended = [e for e in queue.events if e["type"] == "call_ended"]
        assert ended == [{"type": "call_ended", "reason": "silence"}]
        assert service.is_recording()
    finally:
        service.shutdown()


def test_the_silence_is_told_once_while_it_lasts(capture, queue):
    service = LiveRecordingService(capture, queue, poll_interval=0.01, silence_after=0.1, silence_check=0.01)
    try:
        service.start(_request(system=False))
        for job_id in capture.jobs:
            _silent_wav(capture.track_path(job_id))
        assert _wait_for(lambda: "call_ended" in _types(queue))
        time.sleep(0.4)
        assert _types(queue).count("call_ended") == 1
    finally:
        service.shutdown()


def test_the_call_ended_event_matches_its_model(capture, queue):
    from app.api.schemas import CallEndedEvent
    service = LiveRecordingService(capture, queue, poll_interval=0.01, silence_after=0.1, silence_check=0.01)
    try:
        service.start(_request(system=False))
        for job_id in capture.jobs:
            _silent_wav(capture.track_path(job_id))
        assert _wait_for(lambda: "call_ended" in _types(queue))
        event = next(e for e in queue.events if e["type"] == "call_ended")
        assert CallEndedEvent.model_validate(event).model_dump() == event
    finally:
        service.shutdown()


# ── System audio that held nothing ───────────────────────────────────────────
#
# macOS gives a system track of zeros when Sonorus may not record system audio.
# The recording is saved and queued all the same; an event says where to allow
# it, as nothing playing looks the same.

def test_a_system_track_of_zeros_only_is_saved_and_told(service, capture, queue):
    capture.only_zeros = {"system"}
    service.start(_request())
    service.stop()
    _wait_idle(service)
    assert len(queue.snapshot()["jobs"]) == 1
    assert [e for e in queue.events if e["type"] == "recording_system_silent"] == [
        {"type": "recording_system_silent", "title": "Standup"}]
    assert "recording_failed" not in _types(queue)


def test_a_system_track_with_sound_tells_nothing(service, capture, queue):
    service.start(_request())
    service.stop()
    _wait_idle(service)
    assert "recording_system_silent" not in _types(queue)


def test_a_silent_microphone_is_not_a_system_audio_hint(service, capture, queue):
    capture.only_zeros = {"mic"}
    service.start(_request(system=False))
    service.stop()
    _wait_idle(service)
    assert "recording_system_silent" not in _types(queue)


def test_a_recording_that_failed_gives_no_silence_hint(service, capture, queue):
    capture.only_zeros = {"system"}
    capture.fail_stop = RuntimeError("boom")
    service.start(_request())
    service.stop()
    _wait_idle(service)
    assert _types(queue) == ["recording_failed"]


def test_the_system_silent_event_matches_its_model(service, capture, queue):
    from app.api.schemas import RecordingSystemSilentEvent
    capture.only_zeros = {"system"}
    service.start(_request())
    service.stop()
    _wait_idle(service)
    event = next(e for e in queue.events if e["type"] == "recording_system_silent")
    assert RecordingSystemSilentEvent.model_validate(event).model_dump() == event


def test_a_recording_without_diarization_is_queued_without_it(service, queue):
    service.start(_request(title="Plain", diarize=False))
    service.stop()
    _wait_idle(service)
    [job] = queue.snapshot()["jobs"]
    assert job["diarize"] is False
