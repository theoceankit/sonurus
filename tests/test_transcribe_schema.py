"""
Tests for schema and service-layer changes that thread whisper_model and language
through the transcription pipeline.

All tests here are expected to fail until the implementation is added.
This file defines the correct contract.
"""
import inspect
import pytest


# ── TranscribeRequest schema ──────────────────────────────────────────────────

def test_transcribe_request_accepts_audio_path_only():
    """TranscribeRequest still accepts the existing audio_path-only shape."""
    from app.api.schemas import TranscribeRequest
    req = TranscribeRequest(audio_path="/tmp/a.wav")
    assert req.audio_path == "/tmp/a.wav"


def test_transcribe_request_accepts_whisper_model():
    """TranscribeRequest accepts an optional whisper_model field."""
    from app.api.schemas import TranscribeRequest
    req = TranscribeRequest(audio_path="/tmp/a.wav", whisper_model="small")
    assert req.whisper_model == "small"


def test_transcribe_request_accepts_language():
    """TranscribeRequest accepts an optional language field."""
    from app.api.schemas import TranscribeRequest
    req = TranscribeRequest(audio_path="/tmp/a.wav", language="ru")
    assert req.language == "ru"


def test_transcribe_request_accepts_whisper_model_and_language():
    """TranscribeRequest accepts both whisper_model and language together."""
    from app.api.schemas import TranscribeRequest
    req = TranscribeRequest(
        audio_path="/tmp/a.wav",
        whisper_model="medium",
        language="en",
    )
    assert req.whisper_model == "medium"
    assert req.language == "en"


def test_transcribe_request_whisper_model_defaults_to_none():
    """whisper_model defaults to None when not provided."""
    from app.api.schemas import TranscribeRequest
    req = TranscribeRequest(audio_path="/tmp/a.wav")
    assert req.whisper_model is None


def test_transcribe_request_language_defaults_to_none():
    """language defaults to None when not provided."""
    from app.api.schemas import TranscribeRequest
    req = TranscribeRequest(audio_path="/tmp/a.wav")
    assert req.language is None


# ── create_controller signature ───────────────────────────────────────────────

def test_create_controller_accepts_whisper_model_kwarg():
    """create_controller signature must include a whisper_model parameter.

    We check the signature without calling the function end-to-end to avoid
    loading GPU models.
    """
    from app.services.service_factory import create_controller
    sig = inspect.signature(create_controller)
    assert "whisper_model" in sig.parameters, (
        f"create_controller must accept a 'whisper_model' keyword argument. "
        f"Current parameters: {list(sig.parameters.keys())}"
    )


def test_create_controller_whisper_model_is_optional():
    """create_controller's whisper_model parameter must have a default value."""
    from app.services.service_factory import create_controller
    sig = inspect.signature(create_controller)
    param = sig.parameters.get("whisper_model")
    assert param is not None, "whisper_model parameter missing"
    assert param.default is not inspect.Parameter.empty, (
        "whisper_model must be optional (have a default value)"
    )


# ── TranscriptionService constructor signature ────────────────────────────────

def test_transcription_service_constructor_accepts_model_name():
    """TranscriptionService.__init__ must accept a model_name parameter.

    Checked via inspect to avoid loading ML models.
    """
    from app.services.transcription_service import TranscriptionService
    sig = inspect.signature(TranscriptionService.__init__)
    assert "model_name" in sig.parameters, (
        f"TranscriptionService.__init__ must have a 'model_name' parameter. "
        f"Current parameters: {list(sig.parameters.keys())}"
    )


def test_transcription_service_constructor_model_name_is_optional():
    """TranscriptionService.__init__ model_name parameter must have a default value."""
    from app.services.transcription_service import TranscriptionService
    sig = inspect.signature(TranscriptionService.__init__)
    param = sig.parameters.get("model_name")
    assert param is not None, "model_name parameter missing from __init__"
    assert param.default is not inspect.Parameter.empty, (
        "model_name must be optional (have a default value, e.g. WHISPER_MODEL)"
    )


# ── TranscriptionService.transcribe signature ─────────────────────────────────

def test_transcription_service_transcribe_accepts_language():
    """TranscriptionService.transcribe must accept a language parameter.

    Checked via inspect to avoid loading ML models.
    """
    from app.services.transcription_service import TranscriptionService
    sig = inspect.signature(TranscriptionService.transcribe)
    assert "language" in sig.parameters, (
        f"TranscriptionService.transcribe must have a 'language' parameter. "
        f"Current parameters: {list(sig.parameters.keys())}"
    )


def test_transcription_service_transcribe_language_is_optional():
    """TranscriptionService.transcribe language parameter must have a default value."""
    from app.services.transcription_service import TranscriptionService
    sig = inspect.signature(TranscriptionService.transcribe)
    param = sig.parameters.get("language")
    assert param is not None, "language parameter missing from transcribe()"
    assert param.default is not inspect.Parameter.empty, (
        "language must be optional (default to None so auto-detection is preserved)"
    )
