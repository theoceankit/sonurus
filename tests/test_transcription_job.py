"""run_job — one queued job: pipeline, then save + commit in the backend."""
import threading
from unittest.mock import MagicMock, patch

import pytest

import app.config as config
from app.services import pipeline_process
from app.services.pipeline_process import PipelineCancelled
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcription_job import make_job_runner

JOB = {"id": "j1", "audio_path": "/rec/sonorus-import-1.wav", "title": "Weekly sync",
       "whisper_model": "small", "language": "en", "diarize": True}


def _analysis():
    """What the pipeline gives back: one sentence of one diarization speaker
    without a voice (too little speech), so it gets a new speaker."""
    return {"result": {"segments": [{"start": 0.0, "end": 1.0, "text": "hello", "speaker": "SPEAKER_00"}],
                       "language": "en"},
            "voices": {}, "turns": []}


@pytest.fixture(autouse=True)
def models_installed():
    """The pre-run model check (test_job_models.py) passes: no models on disk here."""
    with patch("app.services.transcription_job.require_job_models"):
        yield


@pytest.fixture
def storage(tmp_path):
    return TranscriptStorageService(db_path=str(tmp_path / "db.sqlite"))


# ── In-process pipeline (tests' default, conftest) ────────────────────────────

def test_runs_the_pipeline_saves_with_the_job_title_and_commits(tmp_path):
    steps, saved = [], []
    controller = MagicMock()
    controller.analyse.return_value = _analysis()
    job_storage = MagicMock()
    job_storage.save.side_effect = lambda t: setattr(t, "db_id", 42)
    run = make_job_runner(storage=MagicMock(), memory_db_path=str(tmp_path / "m.db"),
                          on_saved=lambda: saved.append(True))

    with patch("app.services.transcription_job.create_controller",
               return_value=(controller, job_storage)) as create, \
         patch("app.services.transcription_job.CommitService") as commit:
        assert run(JOB, steps.append, threading.Event()) == 42

    create.assert_called_once_with(device=config.DEVICE, whisper_model="small", diarize=True)
    controller.analyse.assert_called_once()
    assert controller.analyse.call_args.args[0] == JOB["audio_path"]
    assert controller.analyse.call_args.kwargs["language"] == "en"
    transcript = job_storage.save.call_args.args[0]
    assert transcript.title == "Weekly sync" and transcript.audio_path == JOB["audio_path"]
    assert [s.text for s in transcript.segments] == ["hello"]
    # Resolved and committed against memory read after the pipeline, not the
    # controller's, which was read when the job started.
    memory = commit.call_args.args[0]
    assert memory is not controller.memory_service and memory.db_path == str(tmp_path / "m.db")
    assert commit.call_args.args[1] is job_storage
    commit.return_value.commit_recognized_speakers.assert_called_once_with(transcript)
    assert steps == ["Loading models…", "Building transcript…", "Saving to database…"]
    assert saved == [True]


def test_cancel_after_the_pipeline_saves_nothing(tmp_path):
    cancel = threading.Event()
    controller = MagicMock()

    def pipeline(audio_path, on_progress, language=None, diarize=True):
        cancel.set()
        return _analysis()

    controller.analyse.side_effect = pipeline
    job_storage = MagicMock()
    run = make_job_runner(storage=MagicMock(), memory_db_path=str(tmp_path / "m.db"), on_saved=lambda: None)
    with patch("app.services.transcription_job.create_controller", return_value=(controller, job_storage)):
        with pytest.raises(PipelineCancelled):
            run(JOB, lambda step: None, cancel)
    job_storage.save.assert_not_called()


def test_models_are_released_when_the_pipeline_fails():
    controller = MagicMock()
    controller.analyse.side_effect = RuntimeError("CUDA out of memory")
    run = make_job_runner(storage=MagicMock(), memory_db_path="m.db", on_saved=lambda: None)
    with patch("app.services.transcription_job.create_controller", return_value=(controller, MagicMock())), \
         patch("torch.cuda.empty_cache") as empty_cache:
        with pytest.raises(RuntimeError, match="CUDA out of memory"):
            run(JOB, lambda step: None, threading.Event())
    assert controller.transcription_service.model is None
    assert controller.embedding_service.inference is None
    empty_cache.assert_called()


def test_models_are_released_when_cancelled_mid_pipeline():
    cancel = threading.Event()

    def on_progress(step):
        if cancel.is_set():
            raise PipelineCancelled()

    def pipeline(audio_path, on_progress, language=None, diarize=True):
        cancel.set()
        on_progress("Transcribing audio…")

    controller = MagicMock()
    controller.analyse.side_effect = pipeline
    run = make_job_runner(storage=MagicMock(), memory_db_path="m.db", on_saved=lambda: None)
    with patch("app.services.transcription_job.create_controller", return_value=(controller, MagicMock())), \
         patch("torch.cuda.empty_cache") as empty_cache:
        with pytest.raises(PipelineCancelled):
            run(JOB, on_progress, cancel)
    assert controller.transcription_service.model is None
    empty_cache.assert_called()


def test_a_failed_commit_still_returns_the_saved_transcript(tmp_path):
    """The transcript exists once saved; a retry would duplicate it."""
    controller = MagicMock()
    controller.analyse.return_value = _analysis()
    job_storage = MagicMock()
    job_storage.save.side_effect = lambda t: setattr(t, "db_id", 5)
    run = make_job_runner(storage=MagicMock(), memory_db_path=str(tmp_path / "m.db"), on_saved=lambda: None)
    with patch("app.services.transcription_job.create_controller", return_value=(controller, job_storage)), \
         patch("app.services.transcription_job.CommitService") as commit:
        commit.return_value.commit_recognized_speakers.side_effect = RuntimeError("db locked")
        assert run(JOB, lambda step: None, threading.Event()) == 5


# ── Child-process pipeline (production) ───────────────────────────────────────

def test_subprocess_mode_loads_no_models_here_and_saves_through_storage(tmp_path, storage):
    seen = {}

    def runner(args, on_progress, cancel_event):
        seen.update(args)
        on_progress("Transcribing audio…")
        return _analysis()

    steps = []
    memory_db = str(tmp_path / "memory.db")
    run = make_job_runner(storage=storage, memory_db_path=memory_db, on_saved=lambda: None)
    with patch.object(pipeline_process, "RUN_PIPELINE_IN_SUBPROCESS", True), \
         patch("app.services.transcription_job.run_pipeline_process", side_effect=runner), \
         patch("app.services.transcription_job.create_controller") as create:
        transcript_id = run(JOB, steps.append, threading.Event())

    create.assert_not_called()
    assert seen == {"audio_path": JOB["audio_path"], "whisper_model": "small", "language": "en",
                    "diarize": True, "db_path": memory_db, "device": config.DEVICE}
    saved = storage.load(transcript_id)
    assert saved.title == "Weekly sync" and saved.audio_path == JOB["audio_path"]
    assert [s.text for s in saved.segments] == ["hello"]
    assert steps == ["Loading models…", "Transcribing audio…", "Building transcript…", "Saving to database…"]


def test_subprocess_mode_passes_the_cancel_event_through(storage):
    cancel = threading.Event()
    got = []

    def runner(args, on_progress, cancel_event):
        got.append(cancel_event)
        raise PipelineCancelled()

    run = make_job_runner(storage=storage, memory_db_path="m.db", on_saved=lambda: None)
    with patch.object(pipeline_process, "RUN_PIPELINE_IN_SUBPROCESS", True), \
         patch("app.services.transcription_job.run_pipeline_process", side_effect=runner):
        with pytest.raises(PipelineCancelled):
            run(JOB, lambda step: None, cancel)
    assert got == [cancel]
    assert storage.list_all() == []


# ── Waveform levels after saving ──────────────────────────────────────────────

def _run_in_process(tmp_path, ensure_levels):
    controller = MagicMock()
    controller.analyse.return_value = _analysis()
    job_storage = MagicMock()
    job_storage.save.side_effect = lambda t: setattr(t, "db_id", 42)
    run = make_job_runner(storage=MagicMock(), memory_db_path=str(tmp_path / "m.db"), on_saved=lambda: None)
    with patch("app.services.transcription_job.create_controller", return_value=(controller, job_storage)), \
         patch("app.services.transcription_job.CommitService"), \
         patch("app.services.transcription_job.ensure_levels", ensure_levels):
        return run(JOB, lambda step: None, threading.Event())


def test_works_out_the_waveform_levels_of_the_saved_recording(tmp_path, monkeypatch):
    import app.config as config
    monkeypatch.setattr(config, "RECORDINGS_DIR", tmp_path / "recordings")
    ensure = MagicMock()

    assert _run_in_process(tmp_path, ensure) == 42

    ensure.assert_called_once_with(JOB["audio_path"], tmp_path / "recordings")


def test_failed_waveform_levels_do_not_fail_the_job(tmp_path):
    assert _run_in_process(tmp_path, MagicMock(side_effect=RuntimeError("ffmpeg died"))) == 42
