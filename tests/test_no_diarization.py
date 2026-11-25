"""A recording transcribed without diarization: no speakers, no diarization
model or token needed, nothing written to speaker memory."""
import shutil
import sqlite3
import threading
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.config as config
from app.api.dependencies import get_memory_service, get_storage_service, get_transcription_queue
from app.api.main import app
from app.controllers.transcription_controller import TranscriptionController, build_transcript
from app.db.schema import SCHEMA_VERSION, init_db
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services import service_factory
from app.services.commit_service import CommitService
from app.services.job_store import JobStore
from app.services.model_service import (
    ALIGNMENT_CATALOG, DIARIZATION_CATALOG, WHISPER_CATALOG, ModelService, require_job_models,
)
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcription_job import make_job_runner
from app.services.transcription_queue import TranscriptionQueue
from queue_helpers import Runner

RESULT = {"language": "en", "segments": [
    {"start": 0.0, "end": 1.0, "text": "One.", "words": [{"word": "One.", "start": 0.0, "end": 1.0}]},
    {"start": 2.0, "end": 3.0, "text": "Two.", "words": [{"word": "Two.", "start": 2.0, "end": 3.0}]},
]}


def _install(root, repo):
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
    _install(config.WHISPER_MODELS_DIR, WHISPER_CATALOG["small"]["hf_repo"])
    _install(config.ALIGNMENT_MODELS_DIR, ALIGNMENT_CATALOG["en"]["hf_repo"])
    queue = TranscriptionQueue(JobStore(db_path=str(tmp_path / "jobs.db")), Runner(),
                               recordings_dir=config.RECORDINGS_DIR)
    queue.start_worker()
    queue.pause()
    db = str(tmp_path / "sonorus.db")
    memory = SpeakerMemoryService(db_path=db)
    app.dependency_overrides[get_transcription_queue] = lambda: queue
    app.dependency_overrides[get_storage_service] = lambda: TranscriptStorageService(db_path=db)
    app.dependency_overrides[get_memory_service] = lambda: memory
    audio = tmp_path / "in.wav"
    audio.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    yield TestClient(app), queue, str(audio), db
    queue.stop_worker()
    app.dependency_overrides.clear()
    (config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR, config.RECORDINGS_DIR) = saved


def _job(client, audio, **body):
    return client.post("/queue/jobs", json={"audio_path": audio, "whisper_model": "small", "language": "en", **body})


# ── The job ──────────────────────────────────────────────────────────────────

def test_a_job_without_diarization_needs_no_diarization_model(api):
    client, _, audio, _ = api
    assert _job(client, audio).json()["code"] == "diarization_model_missing"
    r = _job(client, audio, diarize=False)
    assert r.status_code == 200, r.text
    assert r.json()["diarize"] is False


def test_turning_diarization_on_needs_the_model(api):
    client, _, audio, _ = api
    job = _job(client, audio, diarize=False).json()
    r = client.patch(f"/queue/jobs/{job['id']}", json={"diarize": True})
    assert r.status_code == 400 and r.json()["code"] == "diarization_model_missing"
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        _install(config.HF_MODELS_DIR, repo)
    assert client.patch(f"/queue/jobs/{job['id']}", json={"diarize": True}).json()["diarize"] is True


def test_a_failed_job_turned_off_can_be_retried_without_the_model(api):
    client, queue, audio, _ = api
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        _install(config.HF_MODELS_DIR, repo)
    job = _job(client, audio).json()
    queue._store.update(job["id"], status="failed", error="gone", error_code="diarization_model_missing")
    shutil.rmtree(config.HF_MODELS_DIR)
    assert client.post(f"/queue/jobs/{job['id']}/retry").status_code == 400
    assert client.patch(f"/queue/jobs/{job['id']}", json={"diarize": False}).status_code == 200
    r = client.post(f"/queue/jobs/{job['id']}/retry")
    assert r.status_code == 200 and r.json()["diarize"] is False


def test_the_diarization_model_can_be_deleted_under_a_job_that_does_not_use_it(api):
    client, queue, audio, _ = api
    for repo in DIARIZATION_CATALOG["diarize"]["hf_repos"]:
        _install(config.HF_MODELS_DIR, repo)
    running = {"whisper_model": "small", "language": "en", "diarize": True}
    with patch.object(queue, "running_job", return_value=running):
        assert client.delete("/models/diarize").status_code == 409
    with patch.object(queue, "running_job", return_value={**running, "diarize": False}):
        assert client.delete("/models/diarize").status_code == 200


def test_the_mode_survives_a_new_store(tmp_path):
    db = str(tmp_path / "jobs.db")
    job = JobStore(db).add("/a.wav", "a", "small", None, diarize=False)
    assert JobStore(db).get(job["id"])["diarize"] is False


def test_jobs_from_before_the_choice_find_speakers(tmp_path):
    db = str(tmp_path / "jobs.db")
    with sqlite3.connect(db) as conn:
        conn.execute("""CREATE TABLE transcription_jobs (
            id TEXT PRIMARY KEY, position INTEGER NOT NULL, audio_path TEXT NOT NULL, title TEXT NOT NULL,
            whisper_model TEXT NOT NULL, language TEXT, status TEXT NOT NULL DEFAULT 'waiting',
            error TEXT, error_code TEXT, error_language TEXT, created_at TEXT NOT NULL)""")
        conn.execute("INSERT INTO transcription_jobs (id, position, audio_path, title, whisper_model, created_at) "
                     "VALUES ('old', 0, '/a.wav', 'a', 'small', '2026-01-01')")
    assert JobStore(db).get("old")["diarize"] is True


def test_require_job_models_skips_only_the_diarization_model():
    service = MagicMock(spec=ModelService)
    service.is_installed.side_effect = lambda model: model != "diarize"
    require_job_models(service, "small", None, diarize=False)
    with pytest.raises(Exception):
        require_job_models(service, "small", None, diarize=True)


# ── The pipeline ─────────────────────────────────────────────────────────────

def test_the_controller_is_made_without_the_embedding_model(tmp_path):
    with patch.object(service_factory, "TranscriptionService"), \
         patch.object(service_factory, "EmbeddingService") as embedding:
        controller, _ = service_factory.create_controller(db_path=str(tmp_path / "m.db"), diarize=False)
    embedding.assert_not_called()
    assert controller.embedding_service is None


def test_analyse_without_diarization_has_no_voices():
    transcription = MagicMock()
    transcription.transcribe.return_value = (RESULT, "audio", None)
    controller = TranscriptionController(transcription, None, MagicMock())
    analysis = controller.analyse("/a.wav", language="en", diarize=False)
    transcription.transcribe.assert_called_once_with("/a.wav", language="en", diarize_speakers=False)
    assert analysis == {"result": RESULT, "voices": {}, "turns": [], "diarized": False}


def test_the_transcription_service_does_not_touch_diarization():
    from app.services import transcription_service as module
    service = module.TranscriptionService.__new__(module.TranscriptionService)
    service.device, service.models_dir = "cpu", config.MODELS_DIR
    service.model, service.no_speech = MagicMock(), MagicMock()
    service.model.transcribe.return_value = {"segments": RESULT["segments"], "language": "id"}
    service.no_speech.filter.side_effect = lambda segments: segments
    with patch.object(module, "whisperx") as whisperx, patch.object(module, "torch"), \
         patch.object(module, "diarize") as run_diarization:
        whisperx.load_align_model.return_value = (MagicMock(), {})
        whisperx.align.return_value = {"segments": RESULT["segments"]}
        result, _, diarization = service.transcribe("/a.wav", diarize_speakers=False)
    run_diarization.assert_not_called()
    whisperx.diarize.DiarizationPipeline.assert_not_called()
    whisperx.assign_word_speakers.assert_not_called()
    assert diarization is None and result["language"] == "id"


def test_a_job_without_diarization_leaves_speaker_memory_alone(tmp_path):
    db = str(tmp_path / "sonorus.db")
    memory = SpeakerMemoryService(db_path=db)
    memory.update_embedding("known", np.array([1.0, 0.0, 0.0]), 1)
    memory.set_name("known", "Anna")
    memory.save()
    SpeakerMemoryService(db_path=db)  # gives the name its handle
    tables = ("speaker_embeddings", "speaker_names", "speaker_meta", "speaker_matches")
    storage = TranscriptStorageService(db_path=db)

    def rows():
        with sqlite3.connect(db) as conn:
            return {t: conn.execute(f"SELECT * FROM {t}").fetchall() for t in tables}

    before = rows()
    job = {"id": "j", "audio_path": "/a.wav", "title": "Plain", "whisper_model": "small",
           "language": "en", "diarize": False}
    analysis = {"result": RESULT, "voices": {}, "turns": [], "diarized": False}
    with patch("app.services.transcription_job.require_job_models") as guard, \
         patch("app.services.transcription_job.pipeline_process.RUN_PIPELINE_IN_SUBPROCESS", True), \
         patch("app.services.transcription_job.run_pipeline_process", return_value=analysis) as pipeline, \
         patch("app.services.transcription_job.ensure_levels"):
        transcript_id = make_job_runner(storage, db, lambda: None)(job, lambda step: None, threading.Event())
    assert guard.call_args.args[1:] == ("small", "en", False)
    assert pipeline.call_args.args[0]["diarize"] is False
    assert rows() == before
    saved = storage.load(transcript_id)
    assert saved.diarized is False
    assert all(s.unassigned and s.embedding is None for s in saved.segments)


# ── The transcript ───────────────────────────────────────────────────────────

def test_the_transcript_says_it_has_no_speakers_and_refuses_one(api):
    client, _, _, db = api
    memory = app.dependency_overrides[get_memory_service]()
    transcript = build_transcript({"result": RESULT, "voices": {}, "turns": [], "diarized": False}, memory, "/a.wav")
    tid = TranscriptStorageService(db_path=db).save(transcript)
    assert client.get(f"/transcripts/{tid}").json()["diarized"] is False
    r = client.post(f"/transcripts/{tid}/speaker-assignments", json={"speaker_name": "Anna", "segment_starts": [0.0]})
    assert r.status_code == 409 and r.json()["code"] == "transcript_not_diarized"
    assert "Anna" not in [memory.get_name(i) for i in memory.speaker_ids()]


def test_an_undo_gives_no_speaker_to_a_transcript_without_speakers(api):
    client, _, _, db = api
    memory = app.dependency_overrides[get_memory_service]()
    transcript = build_transcript({"result": RESULT, "voices": {}, "turns": [], "diarized": False}, memory, "/a.wav")
    storage = TranscriptStorageService(db_path=db)
    tid = storage.save(transcript)
    speaker = "0b6f8f5e-6a0c-4f43-9d8e-3c2a1b0f9e7d"
    r = client.post(f"/transcripts/{tid}/speaker-assignments/undo",
                    json={"speaker_id": speaker, "segment_starts": [0.0, 2.0]})
    assert r.status_code == 409 and r.json()["code"] == "transcript_not_diarized"
    assert all(s.unassigned and s.speaker_final is None for s in storage.load(tid).segments)


def test_transcripts_from_before_the_choice_are_diarized(tmp_path):
    db = str(tmp_path / "old.db")
    storage = TranscriptStorageService(db_path=db)
    tid = storage.save(Transcript(audio_path="/a.wav", language="en",
                                  segments=[Segment(0.0, 1.0, "Hi", "SPEAKER_00")]))
    with sqlite3.connect(db) as conn:
        conn.execute("ALTER TABLE transcriptions DROP COLUMN diarized")
        conn.execute("UPDATE _ts_schema_version SET version = 9")
        init_db(conn)
        assert conn.execute("SELECT version FROM _ts_schema_version").fetchone()[0] == SCHEMA_VERSION
    assert TranscriptStorageService(db_path=db).load(tid).diarized is True
