"""Runs one queued transcription job: the pipeline (in a child process in
production), then saving the transcript and committing speakers here."""
import os

import app.config as config
from app.logger import get_logger
from app.services import pipeline_process
from app.services.commit_service import CommitService
from app.services.model_service import ModelService, require_job_models
from app.services.pipeline_process import PipelineCancelled, run_pipeline_process
from app.services.service_factory import create_controller
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.warnings import suppress_ml_noise

log = get_logger("TranscriptionJob")

_VERBOSE = os.getenv("VERBOSE", "false").lower() == "true"


def _release_models(controller) -> None:
    """Drop model references and return cached GPU memory to the driver.

    Only matters in-process (tests): a child process frees everything on
    exit. Runs after every in-process pipeline — success, error or cancel.
    """
    if controller is not None:
        controller.transcription_service.model = None
        controller.embedding_service.inference = None
    import gc
    gc.collect()
    import torch
    torch.cuda.empty_cache()


def make_job_runner(storage: TranscriptStorageService, memory_db_path: str, on_saved):
    """Return run_job(job, on_progress, cancel_event) -> transcript id for
    TranscriptionQueue. on_saved() runs after a transcript is saved (the API
    reloads its cached speaker memory)."""

    def run_job(job: dict, on_progress, cancel_event) -> int:
        # Before any ML import or child process: a job never runs with (and so
        # never downloads) a model that is not installed.
        require_job_models(
            ModelService(config.WHISPER_MODELS_DIR, config.HF_MODELS_DIR, config.ALIGNMENT_MODELS_DIR),
            job["whisper_model"], job["language"],
        )
        on_progress("Loading models…")
        if pipeline_process.RUN_PIPELINE_IN_SUBPROCESS:
            transcript = run_pipeline_process(
                {"audio_path": job["audio_path"], "whisper_model": job["whisper_model"],
                 "language": job["language"], "db_path": memory_db_path},
                on_progress, cancel_event,
            )
            memory, job_storage = SpeakerMemoryService(db_path=memory_db_path), storage
        else:
            if not _VERBOSE:
                suppress_ml_noise("thread")
            controller = None
            try:
                controller, job_storage = create_controller(whisper_model=job["whisper_model"])
                transcript = controller.run_pipeline(job["audio_path"], on_progress=on_progress,
                                                     language=job["language"])
                memory = controller.memory_service
            finally:
                _release_models(controller)

        if cancel_event.is_set():
            raise PipelineCancelled()

        transcript.title = job["title"]
        on_progress("Saving to database…")
        job_storage.save(transcript)
        # The transcript exists from here on: a failed speaker commit must
        # not fail the job, or a retry would save it twice.
        try:
            CommitService(memory, job_storage).commit_recognized_speakers(transcript)
        except Exception as exc:
            log.error(f"Speaker commit failed for transcript {transcript.db_id}: {exc}")
        on_saved()
        return transcript.db_id

    return run_job
