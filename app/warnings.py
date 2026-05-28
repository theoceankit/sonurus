"""Single source for ML library noise suppression."""
import logging
import warnings

_NOISY_LOGGERS = [
    "whisperx", "whisperx.asr", "whisperx.vads.pyannote", "whisperx.diarize",
    "lightning", "lightning.pytorch", "lightning.fabric",
    "lightning.fabric.utilities.rank_zero",
    "lightning.pytorch.utilities.upgrade_checkpoint",
    "pytorch_lightning",
]

_IMPORT_TIME_MODULES = ("pyannote",)
_THREAD_TIME_MODULES = ("lightning", "pyannote", "torch")


def suppress_ml_noise(context: str = "thread") -> None:
    """Silence noisy ML libraries.

    context="startup" — import-time warnings (call before ML modules are imported).
    context="thread"  — runtime warnings inside a worker thread (superset of startup).
    """
    for mod in _IMPORT_TIME_MODULES:
        warnings.filterwarnings("ignore", module=mod)

    if context == "thread":
        for mod in _THREAD_TIME_MODULES:
            warnings.filterwarnings("ignore", module=mod)
        for name in _NOISY_LOGGERS:
            logging.getLogger(name).setLevel(logging.ERROR)
        for name, logger in logging.root.manager.loggerDict.items():
            if isinstance(logger, logging.Logger):
                if any(name.startswith(p) for p in ("lightning", "pytorch_lightning", "pyannote", "whisperx")):
                    logger.setLevel(logging.ERROR)
