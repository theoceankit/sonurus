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
