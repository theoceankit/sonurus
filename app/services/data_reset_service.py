"""Full data reset — wipes transcripts, speakers, app-owned audio files and the
backend's own settings."""
import os
import shutil
from pathlib import Path

from app.logger import get_logger
from app.services.app_settings import AppSettings
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService

log = get_logger("DataReset")


def _count_files(path: Path) -> int:
    return sum(len(files) + sum(1 for d in dirs if (Path(root) / d).is_symlink())
               for root, dirs, files in os.walk(path))


def clear_dir_contents(path: Path) -> int:
    """Delete everything inside path (the directory itself is kept).

    Symlinks are removed as links — their targets are never touched, so
    audio files outside the data directory survive. Returns the number of
    files (and links) removed. A missing directory is a no-op.
    """
    path = Path(path)
    if not path.is_dir() or path.is_symlink():
        return 0
    removed = 0
    for entry in path.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            entry.unlink()
            removed += 1
        else:
            removed += _count_files(entry)
            shutil.rmtree(entry)
    return removed


class DataResetService:
    def __init__(
        self,
        storage: TranscriptStorageService,
        memory: SpeakerMemoryService,
        file_dirs: list[Path],
        settings: AppSettings | None = None,
    ):
        self.storage = storage
        self.settings = settings
        self.memory = memory
        self.file_dirs = [Path(d) for d in file_dirs]

    def reset(self) -> dict:
        """Delete all transcripts, all speakers (named ones too) and the
        contents of file_dirs; the backend's settings go back to their defaults
        (the MCP server is off again). Schema/version tables are kept."""
        transcripts = self.storage.clear()
        speakers = self.memory.clear()
        files = sum(clear_dir_contents(d) for d in self.file_dirs)
        if self.settings is not None:
            self.settings.clear()
        log.info(f"Data reset: {transcripts} transcripts, {speakers} speakers, {files} files removed")
        return {"transcripts": transcripts, "speakers": speakers, "files": files}
