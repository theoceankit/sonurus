"""Sonorus sends no usage data to third parties.

Python runs this file before any app module, so the variables below are set
before pyannote, whisperx or transformers is imported, in the backend and in
every child process it spawns (which also inherits them). They are assigned,
not defaulted: the user's environment cannot switch telemetry back on.
"""
import os

THIRD_PARTY_TELEMETRY_OFF = {
    # pyannote.audio 4 exports OpenTelemetry traces to otel.pyannote.ai (models
    # and pipelines loaded, duration of processed files). Read on every call;
    # pyannote sets it to "true" at import when it is missing.
    "PYANNOTE_METRICS_ENABLED": "false",
    # Turns the OpenTelemetry SDK pyannote creates at import into a no-op, in
    # case a pyannote release stops honouring its own switch.
    "OTEL_SDK_DISABLED": "true",
    # huggingface_hub / transformers usage telemetry (also in model downloads).
    "HF_HUB_DISABLE_TELEMETRY": "1",
    # The cross-tool opt-out, honoured by huggingface_hub and others.
    "DO_NOT_TRACK": "1",
}

os.environ.update(THIRD_PARTY_TELEMETRY_OFF)


def disable_onnxruntime_telemetry() -> None:
    """onnxruntime's Windows builds report telemetry events through Windows
    diagnostic data unless told not to (a no-op on other platforms). It has no
    environment switch: called in the pipeline process before any model loads
    (pyannote and faster-whisper run onnxruntime there)."""
    try:
        import onnxruntime
    except ImportError:
        return
    onnxruntime.disable_telemetry_events()
