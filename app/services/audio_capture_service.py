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


@dataclass
class _CaptureJob:
    process: subprocess.Popen
    output_path: str
    log_path: str


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

    # ── Public API ──────────────────────────────────────────────────────────

    def get_sources(self) -> list[dict]:
        p = sys.platform
        if p == "darwin":
            if not self._capture_bin:
                return []
            return [{"id": "sckit", "label": "System audio (ScreenCaptureKit)"}]
        if p == "win32":
            return []  # Windows captures system audio in the renderer (WASAPI loopback)
        return self._linux_sources()

    def has_active_jobs(self) -> bool:
        with self._lock:
            return bool(self._jobs)

    def start_capture(self, source_id: str | None = None) -> str:
        job_id = str(uuid.uuid4())
        output_path = str(Path(tempfile.gettempdir()) / f"sonorus-sys-{job_id}.wav")
        log_path = str(Path(tempfile.gettempdir()) / f"sonorus-sys-{job_id}.log")
        cmd = self._build_command(source_id, output_path)
        is_darwin = sys.platform == "darwin"
        # stderr goes to a file, never a pipe: the capture process runs for the
        # whole recording and would block once an unread pipe buffer fills up.
        # stdout is only needed on macOS for the READY handshake.
        with open(log_path, "wb") as log_file:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE if is_darwin else subprocess.DEVNULL,
                stderr=log_file,
            )

        if is_darwin:
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
            log.warning("sonorus-capture stderr:\n%s", stderr_out)

        out = Path(job.output_path)
        size = out.stat().st_size if out.exists() else -1
        log.info("sonorus-capture output: %s  size=%d bytes", job.output_path, size)

        if size < 44:
            raise RuntimeError(
                "No audio was captured. If using system audio, grant Screen Recording "
                "permission in System Settings → Privacy & Security → Screen Recording."
            )

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
        p = sys.platform
        if p == "darwin":
            if not self._capture_bin:
                raise RuntimeError("sonorus-capture binary not found; run: npm run build:capture")
            return [self._capture_bin, "--output", output_path]
        if p == "win32":
            raise RuntimeError("System audio on Windows is captured in the renderer, not the backend")
        quiet = ["-nostats", "-loglevel", "error"]
        # Linux
        source = source_id or "default.monitor"
        return [self._ffmpeg(), *quiet, "-f", "pulse", "-i", source,
                "-ar", "44100", "-ac", "2", output_path]

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

    def _linux_sources(self) -> list[dict]:
        try:
            result = subprocess.run(
                ["pactl", "list", "short", "sources"],
                capture_output=True, text=True, timeout=5,
            )
            sources = []
            for line in result.stdout.splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    name = parts[1]
                    if "monitor" in name.lower():
                        label = name.replace("alsa_output.", "").replace(".monitor", "")
                        sources.append({"id": name, "label": f"{label} (Monitor)"})
            return sources
        except Exception:
            return []


def _read_log(path: str, limit: int = 4096) -> str:
    """Return the tail of a capture process log file ('' if unreadable)."""
    try:
        with open(path, "rb") as f:
            return f.read()[-limit:].decode(errors="replace").strip()
    except OSError:
        return ""
