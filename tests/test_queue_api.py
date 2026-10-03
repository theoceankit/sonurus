"""Transcription queue API: /queue/* and WS /ws/queue.

The pipeline is replaced by a Runner; model guards are in
test_transcription_guard.py."""
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app.config as config
from app.api.dependencies import get_memory_service, get_storage_service, get_transcription_queue
from app.api.main import app
from app.services.job_store import JobStore
from app.services.model_service import ALIGNMENT_CATALOG, DIARIZATION_CATALOG, WHISPER_CATALOG
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcription_queue import TranscriptionQueue
from queue_helpers import Runner, wait_for


def _install(root: Path, repo: str) -> None:
    refs = root / ("models--" + repo.replace("/", "--")) / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text("abc123")


@pytest.fixture
def api(tmp_path):
    saved = (config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR, config.RECORDINGS_DIR)
    config.WHISPER_MODELS_DIR = tmp_path / "whisper"
    config.HF_MODELS_DIR = tmp_path / "hf"
    config.ALIGNMENT_MODELS_DIR = tmp_path / "alignment"
    config.RECORDINGS_DIR = tmp_path / "data" / "recordings"
    for model in ("small", config.WHISPER_MODEL):
        _install(config.WHISPER_MODELS_DIR, WHISPER_CATALOG[model]["hf_repo"])
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        _install(config.HF_MODELS_DIR, repo)

    runner = Runner()
    queue = TranscriptionQueue(JobStore(db_path=str(tmp_path / "jobs.db")), runner,
                               recordings_dir=config.RECORDINGS_DIR)
    queue.start_worker()
    queue.pause()  # jobs wait unless a test starts the queue
    app.dependency_overrides[get_transcription_queue] = lambda: queue
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(
        db_path=str(tmp_path / "transcripts.db"))
    app.dependency_overrides[get_memory_service] = lambda: SpeakerMemoryService(
        db_path=str(tmp_path / "memory.db"))

    yield TestClient(app), queue, runner, tmp_path

    queue.stop_worker()
    app.dependency_overrides.clear()
    (config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR, config.RECORDINGS_DIR) = saved


def _file(tmp_path, name="Team Meeting.wav") -> str:
    p = tmp_path / "in" / name
    p.parent.mkdir(exist_ok=True)
    p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    return str(p)


def _imports(tmp_path) -> list[Path]:
    rec = tmp_path / "data" / "recordings"
    return sorted(rec.glob("sonorus-import-*")) if rec.exists() else []


def _post(tc, tmp_path, name="Team Meeting.wav", **body):
    r = tc.post("/queue/jobs", json={"audio_path": _file(tmp_path, name), "whisper_model": "small", **body})
    assert r.status_code == 200, r.text
    return r.json()


# ── Adding jobs ───────────────────────────────────────────────────────────────

def test_add_copies_the_import_and_queues_a_waiting_job(api):
    tc, queue, runner, tmp_path = api
    job = _post(tc, tmp_path)
    [copy] = _imports(tmp_path)
    assert job["audio_path"] == str(copy)
    assert copy.read_bytes() == Path(_file(tmp_path)).read_bytes()
    assert (job["status"], job["title"], job["whisper_model"], job["language"]) == \
        ("waiting", "Team Meeting", "small", None)
    assert [j["id"] for j in queue.snapshot()["jobs"]] == [job["id"]]
    assert runner.started == []  # the queue is paused


def test_add_keeps_a_given_title_and_language(api):
    tc, _, _, tmp_path = api
    job = _post(tc, tmp_path, title="Weekly sync", language="en")
    assert (job["title"], job["language"]) == ("Weekly sync", "en")


def test_add_auto_language_is_stored_as_none(api):
    tc, _, _, tmp_path = api
    assert _post(tc, tmp_path, language="auto")["language"] is None


def test_add_default_model(api):
    tc, _, _, tmp_path = api
    r = tc.post("/queue/jobs", json={"audio_path": _file(tmp_path)})
    assert r.json()["whisper_model"] == config.WHISPER_MODEL


def test_add_live_recording_is_not_copied(api):
    tc, _, _, tmp_path = api
    rec = tmp_path / "data" / "recordings" / "sonorus-rec-1.webm"
    rec.parent.mkdir(parents=True)
    rec.write_bytes(b"x")
    job = tc.post("/queue/jobs", json={"audio_path": str(rec), "whisper_model": "small"}).json()
    assert job["audio_path"] == str(rec) and job["title"] == "sonorus-rec-1"
    assert _imports(tmp_path) == []


def test_add_missing_file_is_400(api):
    tc, queue, _, tmp_path = api
    r = tc.post("/queue/jobs", json={"audio_path": str(tmp_path / "nope.wav"), "whisper_model": "small"})
    assert r.status_code == 400
    assert queue.snapshot()["jobs"] == []


def test_add_copy_failure_is_400_and_queues_nothing(api):
    tc, queue, _, tmp_path = api
    with patch("app.services.audio_store.shutil.copy2", side_effect=OSError(28, "No space left on device")):
        r = tc.post("/queue/jobs", json={"audio_path": _file(tmp_path), "whisper_model": "small"})
    assert r.status_code == 400 and "copy" in r.json()["detail"].lower()
    assert queue.snapshot()["jobs"] == [] and _imports(tmp_path) == []


def test_old_transcribe_endpoints_are_gone(api):
    tc, _, _, tmp_path = api
    assert tc.post("/transcribe", json={"audio_path": _file(tmp_path)}).status_code in (404, 405)
    assert tc.delete("/transcribe/x").status_code in (404, 405)


# ── Snapshot, start, pause ────────────────────────────────────────────────────

def test_get_queue_returns_the_snapshot(api):
    tc, _, _, tmp_path = api
    job = _post(tc, tmp_path)
    s = tc.get("/queue").json()
    assert s["type"] == "snapshot" and s["paused"] is True and s["start_mode"] == "auto"
    assert [j["id"] for j in s["jobs"]] == [job["id"]]


def test_start_runs_the_queue_and_pause_stops_it(api):
    tc, queue, runner, tmp_path = api
    runner.hold("Team Meeting")
    _post(tc, tmp_path)
    s = tc.post("/queue/start").json()
    assert s["paused"] is False
    wait_for(lambda: runner.started == ["Team Meeting"])
    s = tc.post("/queue/pause").json()
    assert s["paused"] is True
    wait_for(lambda: queue.snapshot()["running_job_id"] is None)
    assert runner.cancelled == ["Team Meeting"]
    runner.release("Team Meeting")
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["jobs"] == [])


def test_recording_endpoints(api):
    tc, _, _, _ = api
    tc.post("/queue/start")
    s = tc.post("/queue/recording/start").json()
    assert (s["recording"], s["paused"], s["paused_by_recording"]) == (True, True, True)
    s = tc.post("/queue/recording/stop").json()
    assert (s["recording"], s["paused"]) == (False, False)


def test_settings(api):
    tc, _, _, _ = api
    assert tc.put("/queue/settings", json={"start_mode": "manual"}).json()["start_mode"] == "manual"
    assert tc.get("/queue").json()["start_mode"] == "manual"
    assert tc.put("/queue/settings", json={"start_mode": "sometimes"}).status_code == 422


# ── Editing jobs ──────────────────────────────────────────────────────────────

def test_patch_changes_only_the_fields_sent(api):
    tc, _, _, tmp_path = api
    job = _post(tc, tmp_path, language="en")
    r = tc.patch(f"/queue/jobs/{job['id']}", json={"title": "  Weekly sync "})
    assert r.status_code == 200
    got = r.json()
    assert (got["title"], got["whisper_model"], got["language"]) == ("Weekly sync", "small", "en")
    got = tc.patch(f"/queue/jobs/{job['id']}", json={"language": "auto", "whisper_model": config.WHISPER_MODEL}).json()
    assert (got["language"], got["whisper_model"]) == (None, config.WHISPER_MODEL)


def test_patch_validation(api):
    tc, _, _, tmp_path = api
    job = _post(tc, tmp_path)
    url = f"/queue/jobs/{job['id']}"
    assert tc.patch(url, json={"title": "   "}).status_code == 422
    assert tc.patch(url, json={"title": "x" * 201}).status_code == 422
    r = tc.patch(url, json={"whisper_model": "tiny"})
    assert r.status_code == 400 and "tiny" in r.json()["detail"]
    lang = next(iter(ALIGNMENT_CATALOG))
    r = tc.patch(url, json={"language": lang})
    assert r.status_code == 400 and "lignment" in r.json()["detail"]
    assert tc.patch("/queue/jobs/nope", json={"title": "x"}).status_code == 404


def test_patch_the_running_job_is_409(api):
    tc, _, runner, tmp_path = api
    runner.hold("Team Meeting")
    job = _post(tc, tmp_path)
    tc.post("/queue/start")
    wait_for(lambda: runner.started == ["Team Meeting"])
    assert tc.patch(f"/queue/jobs/{job['id']}", json={"title": "x"}).status_code == 409
    runner.release("Team Meeting")


def test_delete_removes_the_job_and_its_audio(api):
    tc, queue, _, tmp_path = api
    job = _post(tc, tmp_path)
    r = tc.delete(f"/queue/jobs/{job['id']}")
    assert r.status_code == 200 and r.json() == {"deleted": True}
    assert queue.snapshot()["jobs"] == [] and _imports(tmp_path) == []
    assert Path(_file(tmp_path)).exists()  # the user's original stays
    assert tc.delete(f"/queue/jobs/{job['id']}").status_code == 404


def test_retry(api):
    tc, queue, runner, tmp_path = api
    runner.outcomes["Team Meeting"] = RuntimeError("boom")
    job = _post(tc, tmp_path)
    assert tc.post(f"/queue/jobs/{job['id']}/retry").status_code == 409  # not failed
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["jobs"][0]["status"] == "failed")
    r = tc.post(f"/queue/jobs/{job['id']}/retry")
    assert r.status_code == 200 and r.json()["status"] in ("waiting", "running")
    assert tc.post("/queue/jobs/nope/retry").status_code == 404


def test_order(api):
    tc, _, _, tmp_path = api
    a, b = _post(tc, tmp_path, "a.wav"), _post(tc, tmp_path, "b.wav")
    s = tc.put("/queue/order", json={"job_ids": [b["id"], a["id"]]}).json()
    assert [j["id"] for j in s["jobs"]] == [b["id"], a["id"]]
    assert tc.put("/queue/order", json={"job_ids": [a["id"]]}).status_code == 400


# ── WebSocket ─────────────────────────────────────────────────────────────────

def test_ws_sends_a_snapshot_then_changes_and_job_events(api):
    tc, _, _, tmp_path = api
    with tc.websocket_connect("/ws/queue") as ws:
        first = ws.receive_json()
        assert first["type"] == "snapshot" and first["jobs"] == []
        job = _post(tc, tmp_path)
        assert ws.receive_json()["jobs"][0]["id"] == job["id"]
        tc.post("/queue/start")
        seen = []
        while not any(e["type"] == "job_done" for e in seen):
            seen.append(ws.receive_json())
        done = next(e for e in seen if e["type"] == "job_done")
        assert (done["job_id"], done["title"]) == (job["id"], "Team Meeting")
        assert any(e["type"] == "snapshot" and e["step"] == "Transcribing audio…" for e in seen)


# ── Guards elsewhere ──────────────────────────────────────────────────────────

class _Capture:
    def has_active_jobs(self):
        return False


def test_speaker_delete_is_409_only_while_a_job_runs(api):
    from app.api.dependencies import get_audio_capture_service
    tc, _, runner, tmp_path = api
    app.dependency_overrides[get_audio_capture_service] = lambda: _Capture()
    runner.hold("Team Meeting")
    _post(tc, tmp_path)
    assert tc.delete("/speakers/some-id").status_code == 404  # queued job: no 409
    tc.post("/queue/start")
    wait_for(lambda: runner.started == ["Team Meeting"])
    assert tc.delete("/speakers/some-id").status_code == 409
    runner.release("Team Meeting")


def test_data_reset_is_409_while_a_job_runs_and_clears_a_paused_queue(api):
    from app.api.dependencies import get_audio_capture_service
    tc, queue, runner, tmp_path = api
    app.dependency_overrides[get_audio_capture_service] = lambda: _Capture()
    runner.hold("a")
    _post(tc, tmp_path, "a.wav"), _post(tc, tmp_path, "b.wav")
    tc.post("/queue/start")
    wait_for(lambda: runner.started == ["a"])
    assert tc.post("/data/reset").status_code == 409
    tc.post("/queue/pause")
    wait_for(lambda: queue.snapshot()["running_job_id"] is None)
    r = tc.post("/data/reset")
    assert r.status_code == 200, r.text
    assert queue.snapshot()["jobs"] == [] and _imports(tmp_path) == []
    runner.release("a")


# ── Missing models: retry, deleting a model a job uses ─────────────────────────

def test_retry_refuses_a_job_whose_model_is_not_installed(api):
    tc, queue, runner, tmp_path = api
    runner.outcomes["Team Meeting"] = RuntimeError("boom")
    job = _post(tc, tmp_path)
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["jobs"][0]["status"] == "failed")
    tc.post("/queue/pause")
    import shutil
    shutil.rmtree(config.WHISPER_MODELS_DIR / ("models--" + WHISPER_CATALOG["small"]["hf_repo"].replace("/", "--")))

    r = tc.post(f"/queue/jobs/{job['id']}/retry")
    assert r.status_code == 400
    assert r.json()["detail"] == 'Whisper model "small" is not installed. Download it in Settings.'
    assert queue.snapshot()["jobs"][0]["status"] == "failed"


def test_retry_refuses_a_job_without_the_diarization_model(api):
    tc, queue, runner, tmp_path = api
    runner.outcomes["Team Meeting"] = RuntimeError("boom")
    job = _post(tc, tmp_path)
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["jobs"][0]["status"] == "failed")
    tc.post("/queue/pause")
    import shutil
    shutil.rmtree(config.HF_MODELS_DIR)

    r = tc.post(f"/queue/jobs/{job['id']}/retry")
    assert r.status_code == 400
    assert "Diarization model is not installed" in r.json()["detail"]


def test_a_model_the_running_job_uses_cannot_be_deleted(api):
    tc, queue, runner, tmp_path = api
    _install(config.WHISPER_MODELS_DIR, WHISPER_CATALOG["base"]["hf_repo"])
    runner.hold("Team Meeting")
    _post(tc, tmp_path)
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["running_job_id"] is not None)

    for model_id in ("small", "diarize"):
        r = tc.delete(f"/models/{model_id}")
        assert r.status_code == 409, model_id
        assert r.json()["detail"] == "In use by the running transcription"
    assert tc.delete("/models/base").status_code == 200   # not the running job's model

    runner.release("Team Meeting")
    wait_for(lambda: queue.snapshot()["running_job_id"] is None)
    assert tc.delete("/models/small").status_code == 200


def test_the_alignment_model_of_the_running_job_cannot_be_deleted(api):
    tc, queue, runner, tmp_path = api
    _install(config.ALIGNMENT_MODELS_DIR, ALIGNMENT_CATALOG["ru"]["hf_repo"])
    _install(config.ALIGNMENT_MODELS_DIR, ALIGNMENT_CATALOG["ja"]["hf_repo"])
    runner.hold("Team Meeting")
    _post(tc, tmp_path, language="ru")
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["running_job_id"] is not None)

    r = tc.delete("/models/ru")
    assert r.status_code == 409 and r.json()["detail"] == "In use by the running transcription"
    assert tc.delete("/models/ja").status_code == 200
    runner.release("Team Meeting")


def test_an_auto_detect_job_does_not_hold_an_alignment_model(api):
    tc, queue, runner, tmp_path = api
    _install(config.ALIGNMENT_MODELS_DIR, ALIGNMENT_CATALOG["ru"]["hf_repo"])
    runner.hold("Team Meeting")
    _post(tc, tmp_path)                       # language auto → null
    tc.post("/queue/start")
    wait_for(lambda: queue.snapshot()["running_job_id"] is not None)
    assert tc.delete("/models/ru").status_code == 200
    runner.release("Team Meeting")
