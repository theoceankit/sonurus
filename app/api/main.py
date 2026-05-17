from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.logger import setup_logging
from app.api.routers import transcripts, speakers, transcription
from app.api.dependencies import get_memory_service, get_storage_service

setup_logging(default_level="info")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_storage_service()
    get_memory_service()
    yield


app = FastAPI(title="Whisper API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only — tighten for production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transcription.router)
app.include_router(transcripts.router)
app.include_router(speakers.router)


@app.get("/health")
def health():
    return {"status": "ok"}
