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
import time
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
# The macOS microphone: the first start waits for the user to answer the
# system's permission prompt.
_MIC_PROMPT_TIMEOUT_SEC = 120.0
# The two tracks of a recording start one after the other, well under a second
# apart. A larger gap between the two start times means a clock jump, not a
# real offset: then the tracks are mixed from 0 as they are.
_MAX_START_GAP_SEC = 30.0
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
    # When the track starts, Unix time (time.time()); both tracks of a recording
    # are timed on this clock.
    started_at: float
    stop_via_stdin: bool = False
    # "system" or "mic".
    kind: str = "system"


# ── Platform drivers ─────────────────────────────────────────────────────────
#
# One driver per OS behind the same small interface: sources() (system audio),
# inputs() (microphones, the default one not listed), check(source_id, kind)
# (raises with a user-facing reason) and command(source_id, output, kind),
# kind being "system" or "mic"; the class attributes say how the process
# starts (handshake: READY on stdout) and stops (stop_via_stdin: "stop" on
# stdin instead of SIGINT).
# Everything around the capture process (start-up check, stop, mic merge,
# moving into recordings/) is shared by AudioCaptureService.

NO_MIC_AUDIO = "No audio was captured from the microphone."

class _MacCapture:
    """ScreenCaptureKit (system audio) and AVCaptureSession (the microphone,
    --input) via the bundled sonorus-capture helper."""

    handshake = True  # prints READY on stdout once capture runs
    stop_via_stdin = False
    ready_timeout = {"mic": _MIC_PROMPT_TIMEOUT_SEC}
    mic_denied_message = (
        "Sonorus may not use the microphone. Allow it in System Settings → "
        "Privacy & Security → Microphone, then try again."
    )
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

    def _microphones(self) -> list[dict] | None:
        """The helper's microphones; None when it cannot list them."""
        if not self._bin:
            return None
        try:
            result = subprocess.run([self._bin, "--list-inputs"], capture_output=True,
                                    text=True, encoding="utf-8", timeout=5)
            if result.returncode != 0:
                return None
            devices = json.loads(result.stdout)
        except (OSError, subprocess.SubprocessError, ValueError):
            return None
        return [d for d in devices if isinstance(d, dict) and d.get("id")]

    def inputs(self) -> list[dict]:
        return sorted(({"id": d["id"], "label": d.get("label") or d["id"]}
                       for d in self._microphones() or []),
                      key=lambda d: d["label"].lower())

    def check(self, source_id: str | None = None, kind: str = "system") -> None:
        if not self._bin:
            raise RuntimeError("sonorus-capture binary not found; run: npm run build:capture")
        if kind == "mic" and source_id:
            devices = self._microphones()
            if devices is not None and source_id not in {d["id"] for d in devices}:
                raise RuntimeError(
                    f"The selected microphone is not available: {source_id}. "
                    "Choose another microphone and try again."
                )

    def command(self, source_id: str | None, output_path: str, kind: str = "system") -> list[str]:
        if not self._bin:
            self.check()
        if kind == "mic":
            return [self._bin, "--input", source_id or "default", "--output", output_path]
        return [self._bin, "--output", output_path]


class _LinuxCapture:
    """PulseAudio / PipeWire source recorded with parec: the monitor of an
    output for system audio, an input source for the microphone.

    parec ships with pactl (pulseaudio-utils, libpulse on Arch), which already
    lists the sources. The bundled ffmpeg is built without PulseAudio input,
    so it is not used for capture.
    """

    handshake = False
    stop_via_stdin = False
    no_audio_message = "No system audio was captured from the selected source."
    DEFAULT_SOURCE = {"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}
    DEFAULT_INPUT = "@DEFAULT_SOURCE@"

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

    def inputs(self) -> list[dict]:
        """Input sources (microphones) by name, alphabetically; [] without pactl."""
        if not shutil.which("pactl"):
            return []
        found = self._inputs_from_json()
        if found is None:
            found = self._inputs_from_text() or []
        return sorted(found, key=lambda s: s["label"].lower())

    def _inputs_from_json(self) -> list[dict] | None:
        out = self._pactl("-f", "json", "list", "sources")
        if out is None:
            return None
        try:
            sources = json.loads(out)
        except ValueError:
            return None
        # A monitor names the output it listens to in monitor_source.
        return [
            {"id": src["name"], "label": src.get("description") or _input_label(src["name"])}
            for src in sources
            if isinstance(src, dict) and src.get("name")
            and not src.get("monitor_source") and not src["name"].endswith(".monitor")
        ]

    def _inputs_from_text(self) -> list[dict] | None:
        out = self._pactl("list", "sources")
        if out is None:
            return None
        inputs, current = [], None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("Source #"):
                current = None
            elif line.startswith("Name:"):
                name = line[len("Name:"):].strip()
                current = None if name.endswith(".monitor") else {"id": name, "label": _input_label(name)}
                if current:
                    inputs.append(current)
            elif line.startswith("Description:") and current:
                desc = line[len("Description:"):].strip()
                if desc:
                    current["label"] = desc
            elif line.startswith("Monitor of Sink:") and current \
                    and line[len("Monitor of Sink:"):].strip() not in ("", "n/a"):
                inputs.remove(current)
                current = None
        return inputs

    def check(self, source_id: str | None = None, kind: str = "system") -> None:
        if not shutil.which("parec"):
            raise RuntimeError(
                "System audio capture needs parec, which was not found. Install "
                "pulseaudio-utils (libpulse on Arch Linux) and try again."
            )
        # PipeWire records the default source instead of failing when the
        # requested one is gone (e.g. Bluetooth headphones switched off).
        if kind == "mic":
            if source_id and source_id != self.DEFAULT_INPUT and shutil.which("pactl"):
                inputs = self._inputs_from_json()
                if inputs is None:
                    inputs = self._inputs_from_text()
                if inputs is not None and source_id not in {i["id"] for i in inputs}:
                    raise RuntimeError(
                        f"The selected microphone is not available: {source_id}. "
                        "Choose another microphone and try again."
                    )
            return
        if source_id and source_id != self.DEFAULT_SOURCE["id"]:
            monitors = self._monitors()
            if monitors is not None and source_id not in {m["id"] for m in monitors}:
                raise RuntimeError(
                    f"The selected system audio source is not available: {source_id}. "
                    "Choose another source and try again."
                )

    def command(self, source_id: str | None, output_path: str, kind: str = "system") -> list[str]:
        default = self.DEFAULT_INPUT if kind == "mic" else self.DEFAULT_SOURCE["id"]
        # The microphone is one voice: mono; system audio keeps its stereo.
        channels = 1 if kind == "mic" else 2
        # A short latency keeps parec's buffer small: with its ~2 s default the
        # tail of the recording is still buffered when SIGINT arrives.
        return [shutil.which("parec") or "parec", "-d", source_id or default,
                "--file-format=wav", "--rate=48000", f"--channels={channels}",
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

    mic_denied_message = (
        "Sonorus may not use the microphone. Turn on Settings → Privacy & security → "
        "Microphone → Let desktop apps access your microphone, then try again."
    )

    def _devices(self, kind: str = "system") -> list[dict] | None:
        """Active output devices (kind "mic": input devices) from the helper;
        None when it cannot list them."""
        if not self._bin:
            return None
        args = [self._bin, "--list", "--input"] if kind == "mic" else [self._bin, "--list"]
        try:
            result = subprocess.run(
                args, capture_output=True, text=True,
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

    def inputs(self) -> list[dict]:
        return sorted(({"id": d["id"], "label": d.get("label") or d["id"]}
                       for d in self._devices("mic") or []),
                      key=lambda d: d["label"].lower())

    def check(self, source_id: str | None = None, kind: str = "system") -> None:
        if not self._bin:
            raise RuntimeError(
                "The audio capture helper (sonorus-capture.exe) was not found; "
                "run: npm run build:capture:win"
            )
        if kind == "mic":
            inputs = self._devices("mic")
            if inputs is None:
                return
            if not inputs:
                raise RuntimeError("No microphone was found. Connect a microphone and try again.")
            if source_id and source_id != self.DEFAULT_SOURCE["id"] \
                    and source_id not in {d["id"] for d in inputs}:
                raise RuntimeError(
                    f"The selected microphone is not available: {source_id}. "
                    "Choose another microphone and try again."
                )
            return
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

    def command(self, source_id: str | None, output_path: str, kind: str = "system") -> list[str]:
        mode = ["--input"] if kind == "mic" else []
        return [self._bin, *mode, "--device", source_id or self.DEFAULT_SOURCE["id"],
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

    def get_inputs(self) -> list[dict]:
        """The microphones; the default one is not listed (source id None)."""
        return self._driver().inputs()

    def has_active_jobs(self) -> bool:
        with self._lock:
            return bool(self._jobs)

    def start_capture(self, source_id: str | None = None, kind: str = "system") -> str:
        """Start capturing one track, kind "system" or "mic"; returns its job id."""
        driver = self._driver()
        driver.check(source_id, kind)
        job_id = str(uuid.uuid4())
        prefix = "sonorus-mic" if kind == "mic" else "sonorus-sys"
        output_path = str(Path(tempfile.gettempdir()) / f"{prefix}-{job_id}.wav")
        log_path = str(Path(tempfile.gettempdir()) / f"{prefix}-{job_id}.log")
        cmd = self._build_command(source_id, output_path, kind=kind)
        # stderr goes to a file, never a pipe: the capture process runs for the
        # whole recording and would block once an unread pipe buffer fills up.
        # stdout is only needed for the READY handshake, stdin only for a stop
        # through stdin (Windows).
        with open(log_path, "wb") as log_file:
            started_at = time.time()
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE if driver.stop_via_stdin else None,
                stdout=subprocess.PIPE if driver.handshake else subprocess.DEVNULL,
                stderr=log_file,
                creationflags=_NO_WINDOW,
            )

        if driver.handshake:
            timeout = getattr(driver, "ready_timeout", {}).get(kind, _READY_TIMEOUT_SEC)
            line = _read_first_line(process.stdout, timeout)
            # The helper writes from READY on, however long it took to start.
            started_at = time.time()
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
                # A helper refused the microphone by the system: say where to allow it.
                if kind == "mic" and "access denied" in stderr.lower() \
                        and getattr(driver, "mic_denied_message", None):
                    Path(log_path).unlink(missing_ok=True)
                    Path(output_path).unlink(missing_ok=True)
                    raise RuntimeError(driver.mic_denied_message)
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
                                             started_at=started_at, stop_via_stdin=driver.stop_via_stdin,
                                             kind=kind)
        return job_id

    def alive(self, job_id: str) -> bool:
        """Whether the capture process of a job still runs: one that ended by
        itself lost its source (a device unplugged, the helper failed)."""
        with self._lock:
            job = self._jobs.get(job_id)
        return job is not None and job.process.poll() is None

    def started_at(self, job_id: str) -> float:
        with self._lock:
            return self._jobs[job_id].started_at

    def discard(self, job_id: str) -> None:
        """Stop a capture at once and remove its files; nothing is kept."""
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return
        try:
            job.process.kill()
            job.process.wait(timeout=_STOP_TIMEOUT_SEC)
        except (OSError, subprocess.SubprocessError):
            pass
        Path(job.output_path).unlink(missing_ok=True)
        Path(job.log_path).unlink(missing_ok=True)

    def discard_all(self) -> None:
        with self._lock:
            ids = list(self._jobs)
        for job_id in ids:
            self.discard(job_id)

    def stop_recording(self, system_job: str | None = None, mic_job: str | None = None) -> str:
        """Stop the tracks of one recording and leave one file in recordings/.

        Both tracks stop together. With both, the microphone is mixed into the
        system audio, shifted by the difference of their start times; system
        audio alone is levelled; a microphone alone is kept as recorded. A
        track whose process already ended by itself is saved up to that point.
        """
        log = logging.getLogger(__name__)
        with self._lock:
            ids = [j for j in (system_job, mic_job) if j]
            if not ids:
                raise ValueError("Nothing to stop")
            if any(j not in self._jobs for j in ids):
                raise ValueError("Job not found")
            system = self._jobs.pop(system_job) if system_job else None
            mic = self._jobs.pop(mic_job) if mic_job else None
        jobs = [j for j in (system, mic) if j]
        for job in jobs:
            _request_stop(job)
        for job in jobs:
            self._wait_exit(job, log)
        try:
            if system:
                self._require_audio(system, self._driver().no_audio_message)
            if mic:
                self._require_audio(mic, NO_MIC_AUDIO)
            self._recordings_dir.mkdir(parents=True, exist_ok=True)
            final = self._recordings_dir / f"sonorus-rec-{system_job or mic_job}.wav"
            if system and mic:
                self._merge(system.output_path, mic.output_path, str(final),
                            mic_delay=_mic_delay(system.started_at, mic.started_at))
            elif system:
                self._level(system.output_path, str(final))
            else:
                shutil.move(mic.output_path, final)
            return str(final)
        finally:
            for job in jobs:
                Path(job.output_path).unlink(missing_ok=True)

    def stop_capture(self, job_id: str, mic_path: str | None = None,
                     mic_started_at: float | None = None) -> str:
        """Stop a capture; with mic_path, mix that microphone track in.

        mic_started_at is when the microphone track starts (Unix time): the
        mix shifts it against the system track by the difference.
        """
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
        self._merge(job.output_path, mic_path, str(final),
                    mic_delay=_mic_delay(job.started_at, mic_started_at))
        Path(job.output_path).unlink(missing_ok=True)
        if self._is_own_recording(mic_path):
            Path(mic_path).unlink(missing_ok=True)
        return str(final)

    # ── Internals ───────────────────────────────────────────────────────────

    def _build_command(self, source_id: str | None, output_path: str, kind: str = "system") -> list[str]:
        return self._driver().command(source_id, output_path, kind)

    def _wait_exit(self, job: _CaptureJob, log) -> None:
        """Wait for a capture process asked to stop; kill it if it hangs."""
        try:
            job.process.wait(timeout=_STOP_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            log.warning("capture process did not exit after the stop request; killing it")
            job.process.kill()
            job.process.wait()
        stderr_out = _read_log(job.log_path)
        Path(job.log_path).unlink(missing_ok=True)
        if stderr_out:
            log.warning("capture stderr:\n%s", stderr_out)

    @staticmethod
    def _require_audio(job: _CaptureJob, message: str) -> None:
        out = Path(job.output_path)
        size = out.stat().st_size if out.exists() else -1
        logging.getLogger(__name__).info("capture output: %s  size=%d bytes", job.output_path, size)
        if size < 44:
            raise RuntimeError(message)

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

    def _merge(self, system_path: str, mic_path: str, merged: str, mic_delay: float = 0.0) -> None:
        """Mix the microphone into the system track.

        mic_delay: how many seconds after the system track the microphone
        starts (negative: before it). The later track is shifted by it, so
        the same moment lines up on both. The mix ends with the microphone,
        which stops when Stop is pressed: the system capture runs on until
        the microphone file is uploaded, and that tail is dropped.
        Levelling runs on each track before the shift, so the silence put
        in front of a track does not take part in it.
        """
        # The mix takes its channel layout from its first input: a mono
        # microphone would turn the system audio mono too.
        mic_shift = ",aformat=channel_layouts=stereo" + _shift(max(mic_delay, 0.0))
        sys_shift = _shift(max(-mic_delay, 0.0))
        levelled = (
            f"[0:a]{_LEVEL_FILTER}{sys_shift}[sys];[1:a]{_LEVEL_FILTER}{mic_shift}[mic];"
            f"[mic][sys]amix=inputs=2:duration=first:normalize=0,{_LIMITER}"
        )
        try:
            self._run_ffmpeg(["-i", system_path, "-i", mic_path,
                              "-filter_complex", levelled, merged])
        except (subprocess.CalledProcessError, OSError) as exc:
            logging.getLogger(__name__).warning(
                "loudness levelling failed (%s); mixing without it", exc)
            plain = (
                f"[0:a]anull{sys_shift}[sys];[1:a]anull{mic_shift}[mic];"
                "[mic][sys]amix=inputs=2:duration=first"
            )
            self._run_ffmpeg(["-i", system_path, "-i", mic_path,
                              "-filter_complex", plain, merged])


def _mic_delay(capture_started_at: float, mic_started_at: float | None) -> float:
    """Seconds the microphone track starts after the system track; 0 when unknown."""
    if mic_started_at is None:
        return 0.0
    delay = mic_started_at - capture_started_at
    if abs(delay) > _MAX_START_GAP_SEC:
        logging.getLogger(__name__).warning(
            "microphone start time is %.1f s away from the system capture start; "
            "mixing the tracks without a shift", delay)
        return 0.0
    return delay


def _shift(seconds: float) -> str:
    """An adelay that puts this much silence in front of a track ('' for none)."""
    ms = round(seconds * 1000)
    return f",adelay=delays={ms}:all=1" if ms > 0 else ""


def _input_label(name: str) -> str:
    """Fallback label from an input source name (no description)."""
    return name.removeprefix("alsa_input.")


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
