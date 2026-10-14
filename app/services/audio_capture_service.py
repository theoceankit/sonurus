import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import RECORDINGS_DIR


_STOP_TIMEOUT_SEC = 10
# A capture process that cannot open its source exits within milliseconds;
# waiting this long at start turns that into a start error instead of an
# empty recording discovered only when the user presses Stop.
_START_CHECK_SEC = 0.5


@dataclass
class _CaptureJob:
    process: subprocess.Popen
    output_path: str
    log_path: str


# ── Platform drivers ─────────────────────────────────────────────────────────
#
# One driver per OS behind the same small interface: sources(),
# check(source_id) (raises with a user-facing reason) and command().
# Everything around the capture process (start-up check, stop, mic merge,
# moving into recordings/) is shared by AudioCaptureService.

class _MacCapture:
    """ScreenCaptureKit via the bundled sonorus-capture helper."""

    handshake = True  # prints READY on stdout once capture runs
    no_audio_message = (
        "No audio was captured. If using system audio, grant Screen Recording "
        "permission in System Settings → Privacy & Security → Screen Recording."
    )

    def __init__(self, capture_bin: str | None):
        self._bin = capture_bin

    def sources(self) -> list[dict]:
        if not self._bin:
            return []
        return [{"id": "sckit", "label": "System audio (ScreenCaptureKit)"}]

    def check(self, source_id: str | None = None) -> None:
        if not self._bin:
            raise RuntimeError("sonorus-capture binary not found; run: npm run build:capture")

    def command(self, source_id: str | None, output_path: str) -> list[str]:
        self.check()
        return [self._bin, "--output", output_path]


class _LinuxCapture:
    """PulseAudio / PipeWire monitor source recorded with parec.

    parec ships with pactl (pulseaudio-utils, libpulse on Arch), which already
    lists the sources. The bundled ffmpeg is built without PulseAudio input,
    so it is not used for capture.
    """

    handshake = False
    no_audio_message = "No system audio was captured from the selected source."
    DEFAULT_SOURCE = {"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}

    def sources(self) -> list[dict]:
        return self._monitors() or [self.DEFAULT_SOURCE]

    def _monitors(self) -> list[dict] | None:
        """Monitor sources from pactl; None when pactl is missing or fails."""
        if not shutil.which("pactl"):
            return None
        try:
            result = subprocess.run(
                ["pactl", "list", "short", "sources"],
                capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        sources = []
        for line in result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                name = parts[1]
                if "monitor" in name.lower():
                    label = name.replace("alsa_output.", "").replace(".monitor", "")
                    sources.append({"id": name, "label": f"{label} (Monitor)"})
        return sources

    def check(self, source_id: str | None = None) -> None:
        if not shutil.which("parec"):
            raise RuntimeError(
                "System audio capture needs parec, which was not found. Install "
                "pulseaudio-utils (libpulse on Arch Linux) and try again."
            )
        # PipeWire records the default source instead of failing when the
        # requested one is gone (e.g. Bluetooth headphones switched off).
        if source_id and source_id != self.DEFAULT_SOURCE["id"]:
            monitors = self._monitors()
            if monitors is not None and source_id not in {m["id"] for m in monitors}:
                raise RuntimeError(
                    f"The selected system audio source is not available: {source_id}. "
                    "Choose another source and try again."
                )

    def command(self, source_id: str | None, output_path: str) -> list[str]:
        source = source_id or self.DEFAULT_SOURCE["id"]
        # A short latency keeps parec's buffer small: with its ~2 s default the
        # tail of the recording is still buffered when SIGINT arrives.
        return [shutil.which("parec") or "parec", "-d", source,
                "--file-format=wav", "--rate=48000", "--channels=2",
                "--latency-msec=100", output_path]


class _NoBackendCapture:
    """Windows: system audio is captured in the renderer (WASAPI loopback)."""

    handshake = False
    no_audio_message = "No system audio was captured."

    def sources(self) -> list[dict]:
        return []

    def check(self, source_id: str | None = None) -> None:
        raise RuntimeError("System audio on Windows is captured in the renderer, not the backend")

    def command(self, source_id: str | None, output_path: str) -> list[str]:
        self.check()


class AudioCaptureService:
    def __init__(self, capture_bin: str | None = None, recordings_dir: Path = RECORDINGS_DIR):
        self._capture_bin = capture_bin or self._find_capture_bin()
        self._recordings_dir = Path(recordings_dir)
        self._jobs: dict[str, _CaptureJob] = {}
        self._lock = threading.Lock()

    # ── Binary discovery ────────────────────────────────────────────────────

    def _find_capture_bin(self) -> str | None:
        env = os.getenv("SONORUS_CAPTURE_BIN")
        if env:
            return env
        fallback = Path(__file__).parents[2] / "electron" / "resources" / "mac" / "sonorus-capture"
        return str(fallback) if fallback.exists() else None

    def _ffmpeg(self) -> str:
        return "ffmpeg"

    def _driver(self):
        p = sys.platform
        if p == "darwin":
            return _MacCapture(self._capture_bin)
        if p == "win32":
            return _NoBackendCapture()
        return _LinuxCapture()

    # ── Public API ──────────────────────────────────────────────────────────

    def get_sources(self) -> list[dict]:
        return self._driver().sources()

    def has_active_jobs(self) -> bool:
        with self._lock:
            return bool(self._jobs)

    def start_capture(self, source_id: str | None = None) -> str:
        driver = self._driver()
        driver.check(source_id)
        job_id = str(uuid.uuid4())
        output_path = str(Path(tempfile.gettempdir()) / f"sonorus-sys-{job_id}.wav")
        log_path = str(Path(tempfile.gettempdir()) / f"sonorus-sys-{job_id}.log")
        cmd = self._build_command(source_id, output_path)
        # stderr goes to a file, never a pipe: the capture process runs for the
        # whole recording and would block once an unread pipe buffer fills up.
        # stdout is only needed for the READY handshake (macOS helper).
        with open(log_path, "wb") as log_file:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE if driver.handshake else subprocess.DEVNULL,
                stderr=log_file,
            )

        if driver.handshake:
            import select as _select
            ready, _, _ = _select.select([process.stdout], [], [], 5.0)
            if not ready:
                process.kill()
                stderr = _read_log(log_path)
                raise RuntimeError(
                    f"sonorus-capture timed out starting.{(' ' + stderr) if stderr else ''}"
                )
            line = process.stdout.readline().decode().strip()
            process.stdout.close()
            if line != "READY":
                stderr = _read_log(log_path)
                raise RuntimeError(
                    f"sonorus-capture failed to start: {stderr or line}"
                )
        else:
            try:
                process.wait(timeout=_START_CHECK_SEC)
            except subprocess.TimeoutExpired:
                pass  # still running: capture has started
            else:
                stderr = _read_log(log_path)
                Path(log_path).unlink(missing_ok=True)
                Path(output_path).unlink(missing_ok=True)
                raise RuntimeError(
                    f"System audio capture failed to start{': ' + stderr if stderr else '.'}"
                )

        with self._lock:
            self._jobs[job_id] = _CaptureJob(process=process, output_path=output_path, log_path=log_path)
        return job_id

    def stop_capture(self, job_id: str, mic_path: str | None = None) -> str:
        import logging
        log = logging.getLogger(__name__)

        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            raise ValueError("Job not found")
        try:
            job.process.send_signal(signal.SIGINT)
        except (ProcessLookupError, OSError):
            pass
        try:
            job.process.wait(timeout=_STOP_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            log.warning("capture process did not exit after SIGINT; killing it")
            job.process.kill()
            job.process.wait()

        stderr_out = _read_log(job.log_path)
        Path(job.log_path).unlink(missing_ok=True)
        if stderr_out:
            log.warning("capture stderr:\n%s", stderr_out)

        out = Path(job.output_path)
        size = out.stat().st_size if out.exists() else -1
        log.info("capture output: %s  size=%d bytes", job.output_path, size)

        if size < 44:
            raise RuntimeError(self._driver().no_audio_message)

        self._recordings_dir.mkdir(parents=True, exist_ok=True)
        final = self._recordings_dir / f"sonorus-rec-{job_id}.wav"
        if mic_path is None:
            shutil.move(job.output_path, final)
            return str(final)
        self._merge(job.output_path, mic_path, str(final))
        Path(job.output_path).unlink(missing_ok=True)
        if self._is_own_recording(mic_path):
            Path(mic_path).unlink(missing_ok=True)
        return str(final)

    # ── Internals ───────────────────────────────────────────────────────────

    def _build_command(self, source_id: str | None, output_path: str) -> list[str]:
        return self._driver().command(source_id, output_path)

    def _is_own_recording(self, path: str) -> bool:
        """True if path is a file inside the recordings dir (safe to delete)."""
        try:
            return Path(path).resolve().parent == self._recordings_dir.resolve()
        except OSError:
            return False

    def _merge(self, system_path: str, mic_path: str, merged: str) -> None:
        subprocess.run(
            [self._ffmpeg(), "-y",
             "-i", system_path, "-i", mic_path,
             "-filter_complex", "amix=inputs=2:duration=shortest",
             merged],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def _read_log(path: str, limit: int = 4096) -> str:
    """Return the tail of a capture process log file ('' if unreadable)."""
    try:
        with open(path, "rb") as f:
            return f.read()[-limit:].decode(errors="replace").strip()
    except OSError:
        return ""
