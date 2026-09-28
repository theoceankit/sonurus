"""Stub heavy ML packages so the test suite runs without them installed.

If a package is importable in the current environment (e.g. during local dev),
the stub is skipped and the real package is used instead.
"""
import importlib.util
import sys
from unittest.mock import MagicMock


def _is_importable(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


if not _is_importable("torch"):
    # torch.Tensor must be a real class — scipy's array-API compat layer calls
    # issubclass(x, torch.Tensor) during import, which fails on a MagicMock.
    class _FakeTensor:
        pass

    _torch = MagicMock()
    _torch.Tensor = _FakeTensor
    _torch.cuda.is_available.return_value = False
    sys.modules["torch"] = _torch
    sys.modules["torch.cuda"] = _torch.cuda
    sys.modules["torch.nn"] = MagicMock()
    sys.modules["torch.nn.functional"] = MagicMock()

    for _name in [
        "torchaudio",
        "whisperx",
        "faster_whisper",
        "ctranslate2",
        "pyannote",
        "pyannote.audio",
        "pyannote.core",
        "pyannote.database",
        "pyannote.metrics",
        "pyannote.pipeline",
        "transformers",
        "pytorch_lightning",
        "pytorch_metric_learning",
        "onnxruntime",
        "huggingface_hub",
    ]:
        sys.modules[_name] = MagicMock()


# ModelService runs each snapshot_download in a child process in production.
# Tests patch huggingface_hub.snapshot_download, which only works in-process.
import app.services.model_service as _model_service  # noqa: E402
_model_service.RUN_DOWNLOADS_IN_SUBPROCESS = False

# The transcription pipeline runs in a child process in production. Tests
# patch create_controller in this process, which only works in-process.
import app.services.pipeline_process as _pipeline_process  # noqa: E402
_pipeline_process.RUN_PIPELINE_IN_SUBPROCESS = False

# No test may touch the network. Several API tests start a download without
# patching it; the download runs in a background thread that outlives the
# test (and any per-test patch), so the stubs are installed for the whole
# session. Tests that need specific behaviour still patch these themselves.
import huggingface_hub as _hf  # noqa: E402


def _no_network(*_args, **_kwargs):
    raise OSError("network access is disabled in tests")


_hf.snapshot_download = lambda *_args, **_kwargs: None
_hf.model_info = _no_network


# The real transcription queue lives in DB_PATH (the project root when no
# SONORUS_DATA_DIR is set). Every test gets a paused queue on its own
# database instead; tests that need a running one override it themselves.
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_transcription_queue(tmp_path_factory):
    from app.api.dependencies import get_transcription_queue
    from app.api.main import app
    from app.services.job_store import JobStore
    from app.services.transcription_queue import TranscriptionQueue

    def never_runs(job, on_progress, cancel_event):
        raise AssertionError("the default test queue never runs jobs")

    # Not in tmp_path: some tests count what is in there.
    root = tmp_path_factory.mktemp("queue")
    queue = TranscriptionQueue(JobStore(db_path=str(root / "jobs.db")), never_runs,
                               recordings_dir=root / "recordings")
    app.dependency_overrides[get_transcription_queue] = lambda: queue
    yield
    app.dependency_overrides.pop(get_transcription_queue, None)
