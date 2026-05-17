import logging
import os
import sys

_LEVEL_MAP = {
    "debug":   logging.DEBUG,
    "info":    logging.INFO,
    "warning": logging.WARNING,
    "error":   logging.ERROR,
    "off":     logging.CRITICAL + 1,
}

_APP_LOGGER = "app"


class _CleanFormatter(logging.Formatter):
    """Strip the 'app.' prefix so output shows [TranscriptionService] not [app.TranscriptionService]."""

    def format(self, record):
        r = logging.makeLogRecord(record.__dict__)
        r.name = r.name.removeprefix(_APP_LOGGER + ".")
        return super().format(r)


def setup_logging(default_level: str = "off") -> None:
    level_str = os.getenv("LOG_LEVEL", default_level).lower()
    level = _LEVEL_MAP.get(level_str, logging.CRITICAL + 1)

    logger = logging.getLogger(_APP_LOGGER)
    logger.setLevel(level)
    logger.propagate = False

    if logger.handlers:
        return

    fmt = _CleanFormatter("%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S")

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(fmt)
    logger.addHandler(stderr_handler)

    log_file = os.getenv("LOG_FILE")
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(fmt)
        logger.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"{_APP_LOGGER}.{name}")
