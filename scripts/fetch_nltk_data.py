"""Installs the NLTK sentence data WhisperX alignment needs (punkt_tab, all
languages) into <prefix of the Python running this script>/nltk_data, where
the pipeline process looks for it (app/nltk_data.py). The app never downloads
it by itself.

    .venv/bin/python scripts/fetch_nltk_data.py              # source checkout
    python-dist/bin/python3 scripts/fetch_nltk_data.py --cache backend-dist
                                                             # scripts/bundle-backend.js

The archive is pinned to a commit of github.com/nltk/nltk_data and checked
against its sha256 (the one NLTK's own index lists). With --cache the archive
is kept in that directory and reused while its checksum matches.
"""
import argparse
import hashlib
import io
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

PUNKT_TAB_URL = ("https://raw.githubusercontent.com/nltk/nltk_data/"
                 "4f15a3d89eefe9748ec1c05be495d91289197155/packages/tokenizers/punkt_tab.zip")
PUNKT_TAB_SHA256 = "e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106"


def default_dest() -> Path:
    return Path(sys.prefix) / "nltk_data"


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as res:
        return res.read()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _archive(url, sha256, cache_dir, fetch) -> bytes:
    cached = Path(cache_dir) / f"punkt_tab-{sha256[:12]}.zip" if cache_dir else None
    if cached and cached.is_file():
        data = cached.read_bytes()
        if _sha256(data) == sha256:
            return data
    data = fetch(url)
    if _sha256(data) != sha256:
        raise ValueError(f"sha256 mismatch for {url}: expected {sha256}, got {_sha256(data)}")
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
    return data


def _check_members(zf: zipfile.ZipFile) -> None:
    for name in zf.namelist():
        p = PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or p.parts[0] != "punkt_tab":
            raise ValueError(f"unexpected file in the punkt_tab archive: {name}")


def install(dest_root, cache_dir=None, url=PUNKT_TAB_URL, sha256=PUNKT_TAB_SHA256, fetch=_download) -> Path:
    """Installs punkt_tab into dest_root/tokenizers/punkt_tab, replacing what
    is there; nothing changes if the archive fails its checks."""
    data = _archive(url, sha256, cache_dir, fetch)
    tokenizers = Path(dest_root) / "tokenizers"
    tokenizers.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tokenizers) as tmp:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            _check_members(zf)
            zf.extractall(tmp)
        target = tokenizers / "punkt_tab"
        shutil.rmtree(target, ignore_errors=True)
        Path(tmp, "punkt_tab").rename(target)
    return target


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dest", type=Path, default=default_dest(), help="nltk_data directory (default: %(default)s)")
    parser.add_argument("--cache", type=Path, help="keep and reuse the downloaded archive in this directory")
    args = parser.parse_args(argv)
    target = install(args.dest, cache_dir=args.cache)
    print(f"NLTK punkt_tab installed in {target}")


if __name__ == "__main__":
    main()
