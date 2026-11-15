"""Speaker photos on disk: one file per photo in the photos dir, named by a fresh
UUID4, so a replaced photo never comes back from a cache. speaker_meta.photo holds
the file name. The UI crops and scales the picture; this only checks that the
bytes are the image they claim to be and writes them where nothing else does."""
import os
import re
import tempfile
import uuid
from pathlib import Path

from app.logger import get_logger

log = get_logger("speaker_photos")

# The UI sends a 256 px square; the cap leaves room without taking a whole picture.
MAX_PHOTO_BYTES = 2 * 1024 * 1024

PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

MEDIA_TYPES = {ext: mime for mime, ext in PHOTO_TYPES.items()}

_NAME_RE = re.compile(r'^[0-9a-f]{32}\.(jpg|png|webp)$')


def _matches(data: bytes, mime: str) -> bool:
    if mime == "image/jpeg":
        return data[:3] == b"\xff\xd8\xff"
    if mime == "image/png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if mime == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def is_photo_name(name: str | None) -> bool:
    """Only names this module makes: a stored name never leads outside the dir."""
    return bool(name) and bool(_NAME_RE.match(name))


def save_photo(data: bytes, mime: str, photos_dir: Path) -> str:
    """Write data as a new photo and return its file name. Raises ValueError when
    the type is not one of PHOTO_TYPES or the bytes are not that image."""
    ext = PHOTO_TYPES.get(mime)
    if ext is None:
        raise ValueError(f"Unsupported photo type: {mime or 'none'}")
    if not _matches(data, mime):
        raise ValueError(f"The file is not a {ext[1:].upper()} image")
    photos_dir = Path(photos_dir)
    photos_dir.mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex + ext
    # Written next to its place and renamed, so a half-written photo is never served.
    fd, tmp = tempfile.mkstemp(dir=photos_dir, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, photos_dir / name)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return name


def photo_path(name: str, photos_dir: Path) -> Path | None:
    if not is_photo_name(name):
        return None
    path = Path(photos_dir) / name
    return path if path.is_file() else None


def delete_photo(name: str | None, photos_dir: Path | None) -> None:
    if photos_dir is None or not is_photo_name(name):
        return
    try:
        (Path(photos_dir) / name).unlink(missing_ok=True)
    except OSError as e:
        log.warning(f"Could not delete photo {name}: {e}")


def remove_orphan_photos(photos_dir: Path, referenced: set[str]) -> int:
    """Delete files no speaker refers to (left by a backend stopped mid-upload, or
    by a speaker removed through an instance that does not own the files)."""
    photos_dir = Path(photos_dir)
    if not photos_dir.is_dir():
        return 0
    removed = 0
    for entry in photos_dir.iterdir():
        if entry.is_file() and entry.name not in referenced:
            entry.unlink(missing_ok=True)
            removed += 1
    if removed:
        log.info(f"Removed {removed} orphan speaker photos")
    return removed
