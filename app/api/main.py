import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_verbose = os.getenv("VERBOSE", "false").lower() == "true"
if not _verbose:
    from app.warnings import suppress_ml_noise
    suppress_ml_noise("startup")

from app.logger import get_logger, setup_logging
from app.api.routers import transcripts, speakers, transcription, models, audio_capture, data, gpu
from app.api.refusals import Refusal, refusal_handler
from app.api.dependencies import (
    get_live_recording_service, get_memory_service, get_mic_activity_service, get_storage_service, get_transcription_queue,
)
from app.services.audio_store import remove_orphan_imports, remove_orphan_levels
from app.services.commit_service import CommitService
from app.services.speaker_photos import remove_orphan_photos
from app.version import get_version
import app.config as config

setup_logging(default_level="info")
log = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage = get_storage_service()
    memory = get_memory_service()
    queue = get_transcription_queue()
    # Import copies no transcript and no queued job references (e.g. the
    # backend stopped between copying a file and queuing it).
    remove_orphan_imports(config.RECORDINGS_DIR, storage.audio_files() | queue.audio_paths())
    # Waveform levels go with their audio.
    remove_orphan_levels(config.RECORDINGS_DIR)
    remove_orphan_photos(config.SPEAKER_PHOTOS_DIR, memory.photo_names())
    # Before the queue commits anything: profiles of an older way of averaging
    # voices are recomputed. On failure the memory stays unmarked and the next
    # start tries again; recognition works meanwhile on the old profiles.
    try:
        CommitService(memory, storage).recompute_outdated_profiles()
    except Exception as exc:
        log.error(f"Recomputing voice profiles failed: {exc}")
    queue.start_worker()
    mic_activity = get_mic_activity_service()
    if config.MIC_WATCH:
        mic_activity.start()
    yield
    mic_activity.stop()
    # A recording still running when the backend goes down is not saved: its
    # capture processes and temp files are let go.
    get_live_recording_service().shutdown()
    queue.stop_worker()
    models.shutdown_executor()


def cors_origins(env=os.environ) -> list[str]:
    origins = ["null", "http://127.0.0.1", "http://localhost"]
    # npm run dev:ui serves the UI from the Vite dev server. Never for a
    # packaged backend: any page on that port could then call it.
    dev_origin = env.get("SONORUS_DEV_UI_ORIGIN")
    if dev_origin and env.get("SONORUS_PACKAGED") != "1":
        origins.append(dev_origin)
    return origins


app = FastAPI(title="Sonorus API", version=get_version(), lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(Refusal, refusal_handler)

app.include_router(transcription.router)
app.include_router(transcripts.router)
app.include_router(speakers.router)
app.include_router(models.router)
app.include_router(audio_capture.router)
app.include_router(data.router)
app.include_router(gpu.router)


@app.get("/health")
def health():
    # Whose backend this is: Electron reuses a backend already running on
    # :8000 only if it serves its data dir (electron/backend-identity.js).
    return {
        "status": "ok",
        "data_dir": str(config.DATA_DIR),
        "packaged": os.getenv("SONORUS_PACKAGED") == "1",
        # Lets the app stop its own backend that outlived it (e.g. a crash).
        "pid": os.getpid(),
    }
