import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

_verbose = os.getenv("VERBOSE", "false").lower() == "true"
if not _verbose:
    from app.warnings import suppress_ml_noise
    suppress_ml_noise("startup")

from app.logger import setup_logging
from app.api.routers import transcripts, speakers, transcription, models, audio_capture, data
from app.api.dependencies import get_memory_service, get_storage_service, get_transcription_queue
from app.services.audio_store import remove_orphan_imports
import app.config as config

setup_logging(default_level="info")


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage = get_storage_service()
    get_memory_service()
    queue = get_transcription_queue()
    # Import copies no transcript and no queued job references (e.g. the
    # backend stopped between copying a file and queuing it).
    remove_orphan_imports(config.RECORDINGS_DIR, storage.audio_files() | queue.audio_paths())
    queue.start_worker()
    yield
    queue.stop_worker()
    models.shutdown_executor()


app = FastAPI(title="Sonorus API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "http://127.0.0.1", "http://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transcription.router)
app.include_router(transcripts.router)
app.include_router(speakers.router)
app.include_router(models.router)
app.include_router(audio_capture.router)
app.include_router(data.router)


@app.get("/health")
def health():
    return {"status": "ok"}
