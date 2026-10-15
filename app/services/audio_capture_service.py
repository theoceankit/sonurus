import logging
import json
import os
import queue
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
# How long a helper with a handshake (READY on stdout) may take to start.
_READY_TIMEOUT_SEC = 5.0
_REPO_ROOT = Path(__file__).parents[2]
# Windows: the helper is a console program; without this flag every run of it
# from the windowless backend flashes a console window. 0 on other OSes.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Loudness levelling of every track that holds system audio. System audio is
# often 15–20 dB below the mic, and participants of a call differ too; Whisper
# then drops the quiet speech. dynaudnorm (per track, before the mix):
#   f=150:g=11  ~1.7 s window, short enough to follow a change of speaker
#   m=100       up to +40 dB (the default +20 dB leaves the gap almost as is)
#   t=0.001     frames below −60 dBFS are not boosted: silence stays silent,
#               background noise is not raised to audible hiss
#   r=0.15      target RMS (≈ −16 dBFS per frame): tracks match in loudness, not
#               in peaks — call/media audio is already compressed and would
#               sound several dB louder than a peaky mic voice at equal peaks
#   p=0.9       peak ceiling
# The mix sums the tracks (normalize=0) and a limiter keeps the sum from clipping.
_LEVEL_FILTER = "dynaudnorm=f=150:g=11:p=0.9:m=100:t=0.001:r=0.15"
_LIMITER = "alimiter=limit=0.95:level=disabled"


@dataclass
class _CaptureJob:
    process: subprocess.Popen
    output_path: str
    log_path: str
    stop_via_stdin: bool = False


# ── Platform drivers ─────────────────────────────────────────────────────────
#
# One driver per OS behind the same small interface: sources(),
# check(source_id) (raises with a user-facing reason) and command(); the
# class attributes say how the process starts (handshake: READY on stdout)
# and stops (stop_via_stdin: "stop" on stdin instead of SIGINT).
# Everything around the capture process (start-up check, stop, mic merge,
# moving into recordings/) is shared by AudioCaptureService.

class _MacCapture:
    """ScreenCaptureKit via the bundled sonorus-capture helper."""

    handshake = True  # prints READY on stdout once capture runs
    stop_via_stdin = False
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
    stop_via_stdin = False
    no_audio_message = "No system audio was captured from the selected source."
    DEFAULT_SOURCE = {"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}

    def sources(self) -> list[dict]:
        # Like Windows: the default output first, then each output device.
        monitors = sorted(self._monitors() or [], key=lambda m: m["label"].lower())
        return [dict(self.DEFAULT_SOURCE), *monitors]

    def _monitors(self) -> list[dict] | None:
        """Monitor sources named after their output device; None when pactl
        is missing or fails."""
        if not shutil.which("pactl"):
            return None
        monitors = self._monitors_from_json()
        return monitors if monitors is not None else self._monitors_from_text()

    @staticmethod
    def _pactl(*args: str) -> str | None:
        # pactl translates its field names ("Name:", "Description:").
        try:
            result = subprocess.run(
                ["pactl", *args], capture_output=True, text=True, timeout=5,
                env={**os.environ, "LC_ALL": "C"},
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return result.stdout if result.returncode == 0 else None

    def _monitors_from_json(self) -> list[dict] | None:
        """pactl >= 16: each sink with its description and monitor source."""
        out = self._pactl("-f", "json", "list", "sinks")
        if out is None:
            return None
        try:
            sinks = json.loads(out)
        except ValueError:
            return None
        return [
            {"id": sink["monitor_source"],
             "label": sink.get("description") or _monitor_label(sink["monitor_source"])}
            for sink in sinks
            if isinstance(sink, dict) and sink.get("monitor_source")
        ]

    def _monitors_from_text(self) -> list[dict] | None:
        """Older pactl: monitor sources from the text list, "Monitor of <device>"."""
        out = self._pactl("list", "sources")
        if out is None:
            return None
        monitors, name = [], None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("Source #"):
                name = None
            elif line.startswith("Name:"):
                name = line[len("Name:"):].strip()
                if name.endswith(".monitor"):
                    monitors.append({"id": name, "label": _monitor_label(name)})
                else:
                    name = None
            elif line.startswith("Description:") and name:
                desc = line[len("Description:"):].strip()
                desc = desc[len("Monitor of "):] if desc.startswith("Monitor of ") else desc
                if desc:
                    monitors[-1]["label"] = desc
        return monitors

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


class _WindowsCapture:
    """WASAPI loopback of an output device via the bundled sonorus-capture.exe.

    `--list` prints the active output devices as JSON; `--device <id|default>
    --output <path>` records, prints READY once capture runs and writes silence
    while nothing plays, so the track lasts as long as the recording. Windows
    cannot send SIGINT to a child process: the helper stops on "stop" (or EOF)
    on stdin.
    """

    handshake = True
    stop_via_stdin = True
    no_audio_message = "No system audio was captured from the selected output device."
    DEFAULT_SOURCE = {"id": "default", "label": "System audio (default)"}

    def __init__(self, capture_bin: str | None):
        self._bin = capture_bin

    def _devices(self) -> list[dict] | None:
        """Active output devices from the helper; None when it cannot list them."""
        if not self._bin:
            return None
        try:
            result = subprocess.run(
                [self._bin, "--list"], capture_output=True, text=True,
                encoding="utf-8", timeout=5, creationflags=_NO_WINDOW,
            )
            if result.returncode != 0:
                return None
            devices = json.loads(result.stdout)
        except (OSError, subprocess.SubprocessError, ValueError):
            return None
        return [d for d in devices if isinstance(d, dict) and d.get("id")]

    def sources(self) -> list[dict]:
        devices = self._devices()
        if not devices:
            return []
        outputs = sorted(({"id": d["id"], "label": d.get("label") or d["id"]} for d in devices),
                         key=lambda d: d["label"].lower())
        return [dict(self.DEFAULT_SOURCE), *outputs]

    def check(self, source_id: str | None = None) -> None:
        if not self._bin:
            raise RuntimeError(
                "The system audio capture helper (sonorus-capture.exe) was not found; "
                "run: npm run build:capture:win"
            )
        devices = self._devices()
        if devices is None:
            return  # listing failed: let the helper report what is wrong
        if not devices:
            raise RuntimeError(
                "No audio output device was found. Connect speakers or headphones and try again."
            )
        if source_id and source_id != self.DEFAULT_SOURCE["id"] \
                and source_id not in {d["id"] for d in devices}:
            raise RuntimeError(
                f"The selected system audio source is not available: {source_id}. "
                "Choose another source and try again."
            )

    def command(self, source_id: str | None, output_path: str) -> list[str]:
        return [self._bin, "--device", source_id or self.DEFAULT_SOURCE["id"],
                "--output", output_path]


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
        if sys.platform == "win32":
            fallback = _REPO_ROOT / "electron" / "resources" / "win" / "sonorus-capture.exe"
        else:
            fallback = _REPO_ROOT / "electron" / "resources" / "mac" / "sonorus-capture"
        return str(fallback) if fallback.exists() else None

    def _ffmpeg(self) -> str:
        return "ffmpeg"

    def _driver(self):
        p = sys.platform
        if p == "darwin":
            return _MacCapture(self._capture_bin)
        if p == "win32":
            return _WindowsCapture(self._capture_bin)
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
        # stdout is only needed for the READY handshake, stdin only for a stop
        # through stdin (Windows).
        with open(log_path, "wb") as log_file:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE if driver.stop_via_stdin else None,
                stdout=subprocess.PIPE if driver.handshake else subprocess.DEVNULL,
                stderr=log_file,
                creationflags=_NO_WINDOW,
            )

        if driver.handshake:
            line = _read_first_line(process.stdout, _READY_TIMEOUT_SEC)
            if line is None:
                process.kill()
                process.wait()
                stderr = _read_log(log_path)
                raise RuntimeError(
                    f"sonorus-capture timed out starting.{(' ' + stderr) if stderr else ''}"
                )
            process.stdout.close()
            if line != "READY":
                process.kill()
                process.wait()
                stderr = _read_log(log_path)
                raise RuntimeError(
                    f"sonorus-capture failed to start: {stderr or line or 'exited before it was ready'}"
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
            self._jobs[job_id] = _CaptureJob(process=process, output_path=output_path, log_path=log_path,
                                             stop_via_stdin=driver.stop_via_stdin)
        return job_id

    def stop_capture(self, job_id: str, mic_path: str | None = None) -> str:
        log = logging.getLogger(__name__)

        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            raise ValueError("Job not found")
        _request_stop(job)
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
            self._level(job.output_path, str(final))
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

    def _run_ffmpeg(self, args: list[str]) -> None:
        subprocess.run(
            [self._ffmpeg(), "-y", *args],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def _level(self, system_path: str, final: str) -> None:
        """Level a system-only recording into final; keep it as is if ffmpeg fails."""
        try:
            self._run_ffmpeg(["-i", system_path, "-af", _LEVEL_FILTER, final])
        except (subprocess.CalledProcessError, OSError) as exc:
            logging.getLogger(__name__).warning(
                "loudness levelling failed (%s); keeping the recording as captured", exc)
            Path(final).unlink(missing_ok=True)
            shutil.move(system_path, final)
        else:
            Path(system_path).unlink(missing_ok=True)

    def _merge(self, system_path: str, mic_path: str, merged: str) -> None:
        levelled = (
            f"[0:a]{_LEVEL_FILTER}[sys];[1:a]{_LEVEL_FILTER}[mic];"
            f"[sys][mic]amix=inputs=2:duration=shortest:normalize=0,{_LIMITER}"
        )
        try:
            self._run_ffmpeg(["-i", system_path, "-i", mic_path,
                              "-filter_complex", levelled, merged])
        except (subprocess.CalledProcessError, OSError) as exc:
            logging.getLogger(__name__).warning(
                "loudness levelling failed (%s); mixing without it", exc)
            self._run_ffmpeg(["-i", system_path, "-i", mic_path,
                              "-filter_complex", "amix=inputs=2:duration=shortest", merged])


def _monitor_label(name: str) -> str:
    """Fallback label from a monitor source name (no device description)."""
    return f"{name.removeprefix('alsa_output.').removesuffix('.monitor')} (Monitor)"


def _request_stop(job: _CaptureJob) -> None:
    """Ask the capture process to finish its file and exit."""
    try:
        if job.stop_via_stdin:
            job.process.stdin.write(b"stop\n")
            job.process.stdin.close()
        else:
            job.process.send_signal(signal.SIGINT)
    except (ProcessLookupError, OSError, ValueError):
        pass  # already gone; wait() below collects it


def _read_first_line(stream, timeout: float) -> str | None:
    """First line of a pipe, or None if none arrives in time.

    select() works only on sockets on Windows, so the line is read on a
    daemon thread; a stuck read ends when the caller kills the process.
    """
    lines: queue.Queue = queue.Queue(maxsize=1)
    threading.Thread(target=lambda: lines.put(stream.readline()), daemon=True).start()
    try:
        raw = lines.get(timeout=timeout)
    except queue.Empty:
        return None
    return (raw.decode(errors="replace") if isinstance(raw, bytes) else str(raw)).strip()


def _read_log(path: str, limit: int = 4096) -> str:
    """Return the tail of a capture process log file ('' if unreadable)."""
    try:
        with open(path, "rb") as f:
            return f.read()[-limit:].decode(errors="replace").strip()
    except OSError:
        return ""
