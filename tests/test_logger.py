"""
Tests for app/logger.py — setup_logging() and get_logger().
"""

import logging
import os
import pytest
from app.logger import setup_logging, get_logger, _APP_LOGGER


@pytest.fixture(autouse=True)
def reset_app_logger():
    """Remove all handlers and reset the app logger between tests."""
    yield
    logger = logging.getLogger(_APP_LOGGER)
    logger.handlers.clear()
    logger.setLevel(logging.WARNING)


# ---------------------------------------------------------------------------
# get_logger()
# ---------------------------------------------------------------------------

def test_get_logger_returns_child_of_app_logger():
    log = get_logger("MyService")
    assert log.name == f"{_APP_LOGGER}.MyService"


def test_get_logger_different_names_are_different_loggers():
    a = get_logger("ServiceA")
    b = get_logger("ServiceB")
    assert a is not b


# ---------------------------------------------------------------------------
# setup_logging() — level control
# ---------------------------------------------------------------------------

def test_setup_logging_off_by_default(capsys):
    setup_logging(default_level="off")
    get_logger("Test").info("should not appear")
    assert capsys.readouterr().err == ""


def test_setup_logging_info_level(capsys):
    setup_logging(default_level="info")
    get_logger("Test").info("hello info")
    assert "hello info" in capsys.readouterr().err


def test_setup_logging_debug_level(capsys):
    setup_logging(default_level="debug")
    get_logger("Test").debug("hello debug")
    assert "hello debug" in capsys.readouterr().err


def test_setup_logging_info_suppresses_debug(capsys):
    setup_logging(default_level="info")
    get_logger("Test").debug("should not appear")
    assert capsys.readouterr().err == ""


def test_setup_logging_env_var_overrides_default(monkeypatch, capsys):
    monkeypatch.setenv("LOG_LEVEL", "info")
    setup_logging(default_level="off")
    get_logger("Test").info("from env var")
    assert "from env var" in capsys.readouterr().err


def test_setup_logging_env_var_off_silences(monkeypatch, capsys):
    monkeypatch.setenv("LOG_LEVEL", "off")
    setup_logging(default_level="info")
    get_logger("Test").info("should not appear")
    assert capsys.readouterr().err == ""


# ---------------------------------------------------------------------------
# Output format
# ---------------------------------------------------------------------------

def test_output_format_strips_app_prefix(capsys):
    setup_logging(default_level="info")
    get_logger("TranscriptionService").info("Loading audio")
    err = capsys.readouterr().err
    assert "[TranscriptionService]" in err
    assert f"[{_APP_LOGGER}.TranscriptionService]" not in err


def test_output_contains_message(capsys):
    setup_logging(default_level="info")
    get_logger("DB").info("INSERT transcriptions id=42")
    assert "INSERT transcriptions id=42" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# LOG_FILE
# ---------------------------------------------------------------------------

def test_log_file_written(tmp_path, monkeypatch):
    log_file = str(tmp_path / "app.log")
    monkeypatch.setenv("LOG_FILE", log_file)
    setup_logging(default_level="info")
    get_logger("Test").info("written to file")

    content = open(log_file).read()
    assert "written to file" in content


def test_log_file_not_created_when_not_set(tmp_path, monkeypatch):
    monkeypatch.delenv("LOG_FILE", raising=False)
    setup_logging(default_level="info")
    assert not (tmp_path / "app.log").exists()
