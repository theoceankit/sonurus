"""Sentence data for WhisperX alignment (NLTK punkt_tab), shipped with the app.

WhisperX splits each segment into sentences with NLTK's punkt_tab tokenizer and,
when the data is not found, downloads it from GitHub into ~/nltk_data — a job
would then fail offline and write outside the app's directories. The data is
installed into the app's own Python instead (scripts/fetch_nltk_data.py: the
installer build runs it with the bundled Python, a source checkout with
.venv/bin/python), and the pipeline process looks nowhere else.
"""
import sys
from pathlib import Path

NLTK_DATA_DIR = Path(sys.prefix) / "nltk_data"


class NltkDataMissingError(RuntimeError):
    pass


def _refuse_download(info_or_id=None, *args, **kwargs):
    raise NltkDataMissingError(
        f"Sentence data for alignment (NLTK {info_or_id or 'data'}) is missing from {NLTK_DATA_DIR}. "
        "Reinstall Sonorus; when running from source, run scripts/fetch_nltk_data.py "
        "with the backend's Python."
    )


def use_bundled_nltk_data() -> None:
    """Limits NLTK to NLTK_DATA_DIR and turns its downloads into
    NltkDataMissingError. Called in the pipeline process before any model
    loads; a no-op without NLTK (the test environment)."""
    try:
        import nltk
    except ImportError:
        return
    nltk.data.path[:] = [str(NLTK_DATA_DIR)]
    nltk.download = _refuse_download
