"""A job resolves its speakers against the speaker memory as it is when the
pipeline is done, not as it was when the job started: the user names,
assigns and merges speakers while a long recording is transcribed."""
import functools
import threading
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services import pipeline_process
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcription_job import make_job_runner
import pipeline_workers

_ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
VOICE = np.array([1.0, 0.0, 0.0], dtype=np.float32)

JOB = {"id": "j1", "audio_path": "/rec/sonorus-import-1.wav", "title": "Weekly sync",
       "whisper_model": "small", "language": "en", "diarize": True}

RESULT = {"segments": [{"start": 0.0, "end": 1.0, "text": "hi", "speaker": "SPEAKER_00"}], "language": "en"}
TURNS = [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00", "embedding": VOICE}]


@pytest.fixture(autouse=True)
def models_installed():
    with patch("app.services.transcription_job.require_job_models"):
        yield


@pytest.fixture
def db(tmp_path):
    return str(tmp_path / "sonorus.db")


def _give_alice_the_voice(db):
    """What the API does meanwhile: Alice gets a name and this voice."""
    api = SpeakerMemoryService(db_path=db)
    api.set_name(_ALICE, "Alice")
    api.update_embedding(_ALICE, VOICE)
    api.save()


def _remove_bob(db):
    SpeakerMemoryService(db_path=db).remove_speaker(_BOB)


def _run_in_process(db, during_pipeline):
    """Runs a job in-process with the real controller on stub models;
    during_pipeline() runs while the audio is transcribed."""
    from app.controllers.transcription_controller import TranscriptionController

    transcription = MagicMock()

    def transcribe(audio_path, language=None, diarize_speakers=True):
        during_pipeline(db)
        return RESULT, MagicMock(), MagicMock()

    transcription.transcribe.side_effect = transcribe
    embedding = MagicMock()
    embedding.extract_all.return_value = ({"SPEAKER_00": VOICE}, TURNS)
    controller = TranscriptionController(transcription, embedding, SpeakerMemoryService(db_path=db))
    storage = TranscriptStorageService(db_path=db)
    run = make_job_runner(storage=storage, memory_db_path=db, on_saved=lambda: None)
    with patch("app.services.transcription_job.create_controller", return_value=(controller, storage)), \
         patch("torch.cuda.empty_cache"):
        db_id = run(JOB, lambda step: None, threading.Event())
    return storage, db_id


def test_a_speaker_given_a_voice_during_the_job_is_recognized(db):
    storage, db_id = _run_in_process(db, _give_alice_the_voice)
    assert storage.load(db_id).segments[0].speaker_resolved == _ALICE
    assert _ALICE in storage.speaker_matches(db_id)


def test_a_speaker_removed_during_the_job_is_not_matched(db):
    bob = SpeakerMemoryService(db_path=db)
    bob.set_name(_BOB, "Bob")
    bob.update_embedding(_BOB, VOICE)
    bob.save()

    storage, db_id = _run_in_process(db, _remove_bob)

    assert storage.load(db_id).segments[0].speaker_resolved != _BOB
    assert storage.speaker_matches(db_id) == {}
    assert _BOB not in SpeakerMemoryService(db_path=db).known_speakers


def test_a_child_process_job_resolves_in_the_backend_on_fresh_memory(db, monkeypatch):
    """The child only analyses; the backend resolves once it is done. The
    memory changes while the child runs, after it started."""
    monkeypatch.setattr(pipeline_process, "RUN_PIPELINE_IN_SUBPROCESS", True)
    run_child = functools.partial(pipeline_process.run_pipeline_process, worker=pipeline_workers.analysis_worker)

    def on_progress(step):
        if step == "Identifying speakers…":
            _give_alice_the_voice(db)

    storage = TranscriptStorageService(db_path=db)
    run = make_job_runner(storage=storage, memory_db_path=db, on_saved=lambda: None)
    with patch("app.services.transcription_job.run_pipeline_process", run_child):
        db_id = run(JOB, on_progress, threading.Event())

    transcript = storage.load(db_id)
    assert transcript.title == "Weekly sync"
    assert transcript.segments[0].speaker_resolved == _ALICE
