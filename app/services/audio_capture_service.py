import os
import signal
import subprocess
import sys
import tempfile
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass
class _CaptureJob:
    process: subprocess.Popen
    output_path: str


class AudioCaptureService:
    def __init__(self, capture_bin: str | None = None):
        self._capture_bin = capture_bin or self._find_capture_bin()
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
            return [{"id": "sckit", "label": "System audio (ScreenCaptureKit)"}]
        if p == "win32":
            return [{"id": "wasapi", "label": "System audio"}]
        return self._linux_sources()

    def start_capture(self, source_id: str | None = None) -> str:
        job_id = str(uuid.uuid4())
        output_path = str(Path(tempfile.gettempdir()) / f"sonorus-sys-{job_id}.wav")
        cmd = self._build_command(source_id, output_path)
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with self._lock:
            self._jobs[job_id] = _CaptureJob(process=process, output_path=output_path)
        return job_id

    def stop_capture(self, job_id: str, mic_path: str | None = None) -> str:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            raise ValueError("Job not found")
        try:
            job.process.send_signal(signal.SIGINT)
        except (ProcessLookupError, OSError):
            pass
        job.process.wait()
        if mic_path is None:
            return job.output_path
        return self._merge(job.output_path, mic_path, job_id)

    # ── Internals ───────────────────────────────────────────────────────────

    def _build_command(self, source_id: str | None, output_path: str) -> list[str]:
        p = sys.platform
        if p == "darwin":
            if not self._capture_bin:
                raise RuntimeError("sonorus-capture binary not found; run: npm run build:capture")
            return [self._capture_bin, "--output", output_path]
        if p == "win32":
            return [self._ffmpeg(), "-f", "wasapi", "-loopback", "1", "-i", "",
                    "-ar", "44100", "-ac", "2", output_path]
        # Linux
        source = source_id or "default.monitor"
        return [self._ffmpeg(), "-f", "pulse", "-i", source,
                "-ar", "44100", "-ac", "2", output_path]

    def _merge(self, system_path: str, mic_path: str, job_id: str) -> str:
        merged = str(Path(tempfile.gettempdir()) / f"sonorus-merged-{job_id}.wav")
        subprocess.run(
            [self._ffmpeg(), "-y",
             "-i", system_path, "-i", mic_path,
             "-filter_complex", "amix=inputs=2:duration=shortest",
             merged],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return merged

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
