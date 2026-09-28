"""App-owned audio: copies of imported files and live recordings.

A transcript must stay playable when the user moves or deletes the file they
imported, so every imported file is copied into RECORDINGS_DIR and the
transcript references the copy. Live recordings are uploaded by the UI and
written there by save_recording(), then used as they are.
"""
import os
import shutil
import uuid
from pathlib import Path
from typing import AsyncIterator

from app.logger import get_logger

log = get_logger("AudioStore")

IMPORT_PREFIX = "sonorus-import-"
RECORDING_PREFIX = "sonorus-rec-"
RECORDING_EXTS = frozenset({"webm", "wav"})


def _in_dir(path: str | Path, directory: str | Path) -> bool:
    """True if path lives directly or deeper inside directory (symlinks in
    the parent chain are resolved, the file itself is not)."""
    parent = Path(os.path.abspath(Path(path).parent)).resolve()
    root = Path(directory).resolve()
    return parent == root or root in parent.parents


def import_audio(src: str, recordings_dir: str | Path) -> str:
    """Copy src into recordings_dir under a unique name and return the copy's
    path. A file already inside recordings_dir is returned unchanged.
    Raises OSError on failure, leaving no partial copy behind."""
    if _in_dir(src, recordings_dir):
        return src
    recordings = Path(recordings_dir)
    recordings.mkdir(parents=True, exist_ok=True)
    dest = recordings / f"{IMPORT_PREFIX}{uuid.uuid4()}{Path(src).suffix.lower()}"
    try:
        shutil.copy2(src, dest)
    except OSError:
        dest.unlink(missing_ok=True)
        raise
    log.info(f"Imported {src} → {dest}")
    return str(dest)


async def save_recording(chunks: AsyncIterator[bytes], ext: str,
                         recordings_dir: str | Path) -> str:
    """Write an uploaded live recording to recordings_dir as
    sonorus-rec-<uuid>.<ext> and return its path. The file appears under its
    final name only when complete. Raises ValueError for an unsupported ext or
    an empty recording; on any failure nothing is left behind."""
    if ext not in RECORDING_EXTS:
        raise ValueError(f"Unsupported recording format: {ext!r}")
    recordings = Path(recordings_dir)
    recordings.mkdir(parents=True, exist_ok=True)
    dest = recordings / f"{RECORDING_PREFIX}{uuid.uuid4()}.{ext}"
    part = dest.with_name(dest.name + ".part")
    size = 0
    try:
        with open(part, "wb") as f:
            async for chunk in chunks:
                f.write(chunk)
                size += len(chunk)
        if size == 0:
            raise ValueError("The recording is empty")
        part.replace(dest)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    log.info(f"Saved recording {dest} ({size} bytes)")
    return str(dest)


def is_import_copy(path: str, recordings_dir: str | Path) -> bool:
    return Path(path).name.startswith(IMPORT_PREFIX) and _in_dir(path, recordings_dir)


def discard_import(path: str, recordings_dir: str | Path) -> None:
    """Delete an import copy (e.g. after a failed job). Anything else —
    live recordings, the user's original files — is left alone."""
    if not is_import_copy(path, recordings_dir):
        return
    try:
        Path(path).unlink(missing_ok=True)
        log.info(f"Discarded import copy {path}")
    except OSError as e:
        log.warning(f"Could not delete import copy {path}: {e}")


def discard_owned_audio(path: str, recordings_dir: str | Path) -> None:
    """Delete an audio file the app owns — a live recording or an import copy
    — e.g. when its queued job is deleted. Files outside recordings_dir (the
    user's originals) are left alone; a symlink is removed, not its target."""
    if not _in_dir(path, recordings_dir):
        return
    try:
        Path(path).unlink(missing_ok=True)
        log.info(f"Deleted {path}")
    except OSError as e:
        log.warning(f"Could not delete {path}: {e}")


def remove_orphan_imports(recordings_dir: str | Path, referenced: set[str]) -> int:
    """Delete import copies no transcript references — left over when the
    backend stopped mid-job. Live recordings are never removed: an
    unreferenced one is still the only copy of that recording."""
    recordings = Path(recordings_dir)
    if not recordings.is_dir():
        return 0
    keep = {Path(p).resolve() for p in referenced}
    removed = 0
    for f in recordings.glob(f"{IMPORT_PREFIX}*"):
        if f.is_file() and f.resolve() not in keep:
            try:
                f.unlink()
                removed += 1
            except OSError as e:
                log.warning(f"Could not delete orphan import {f}: {e}")
    if removed:
        log.info(f"Removed {removed} orphan import copies")
    return removed
