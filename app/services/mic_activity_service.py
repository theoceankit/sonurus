"""Which other apps hold a microphone, and what that says about a call.

A driver per OS reports the holders of a microphone, {app_id, name, pid}
each; the service drops the capture processes of Sonorus and turns the rest
into two signals (CallSignals), sent as queue events over WS /ws/queue:

    mic_app_active   an app held a microphone 15 s without a break while no
                     recording runs: a call may have started. Once per hold.
    call_ended       during a recording another app held a microphone, and
                     now none has for 15 s (reason mic_released). Once, until
                     an app takes the microphone again.

The service only tells; the Electron main process decides from the user's
settings whether that becomes a notification or stops the recording. Nothing
here touches the network: Linux asks the local sound server through pactl.
"""
import json
import os
import shutil
import subprocess
import threading
import time

from app.logger import get_logger
from app.services.audio_capture_service import _LinuxCapture

log = get_logger("MicActivity")

HOLD_SEC = 15.0


# ── Call signals ─────────────────────────────────────────────────────────────

class CallSignals:
    """The signals from the holders seen at each moment; pure, the clock is
    given. Holders are keyed by app_id: two streams of one app are one hold."""

    def __init__(self, hold: float = HOLD_SEC):
        self._hold = hold
        # app_id → {"since": time, "told": bool}
        self._held: dict[str, dict] = {}
        self._recording = False
        self._other_held = False
        self._released_at: float | None = None
        self._ended_told = False

    def update(self, holders: list[dict], recording: bool, now: float) -> list[dict]:
        events = []
        current = {h["app_id"]: h for h in holders}
        for app_id in list(self._held):
            if app_id not in current:
                del self._held[app_id]
        for app_id, holder in current.items():
            held = self._held.setdefault(app_id, {"since": now, "told": False})
            if held["told"] or now - held["since"] < self._hold:
                continue
            held["told"] = True
            # A hold that reaches its time during a recording is not told later either.
            if not recording:
                events.append({"type": "mic_app_active", "app_id": app_id, "name": holder.get("name")})

        if recording and not self._recording:
            self._other_held, self._released_at, self._ended_told = False, None, False
        self._recording = recording
        if recording:
            if current:
                self._other_held, self._released_at, self._ended_told = True, None, False
            elif self._other_held and not self._ended_told:
                if self._released_at is None:
                    self._released_at = now
                if now - self._released_at >= self._hold:
                    self._ended_told = True
                    events.append({"type": "call_ended", "reason": "mic_released"})
        return events


# ── Linux: PulseAudio / PipeWire through pactl ───────────────────────────────

# Names of a stream that say how it records rather than who: the program
# name says more.
_GENERIC_NAMES = ("voiceengine", "webrtc", "pipewire", "pulseaudio", "alsa", "audio stream")


def _display_name(name: str, binary: str) -> str:
    if name and not any(g in name.lower() for g in _GENERIC_NAMES):
        return name
    program = binary.rsplit("/", 1)[-1]
    for suffix in (".exe", ".bin"):
        if program.lower().endswith(suffix):
            program = program[:-len(suffix)]
    if program.islower():
        program = program[:1].upper() + program[1:]
    return program or name


def _holder(props: dict, source_name: str | None, corked: bool) -> dict | None:
    """The app of a recording stream, if it records a microphone."""
    if corked or source_name is None or source_name.endswith(".monitor"):
        return None
    # Level meters (pavucontrol) and other monitoring streams record nothing.
    if props.get("media.name") == "Peak detect" or props.get("application.id") == "org.PulseAudio.pavucontrol" \
            or props.get("stream.monitor") == "true":
        return None
    name = (props.get("application.name") or "").strip()
    binary = (props.get("application.process.binary") or "").strip()
    app_id = (binary or name).lower()
    if not app_id:
        return None
    try:
        pid = int(props.get("application.process.id") or 0) or None
    except ValueError:
        pid = None
    return {"app_id": app_id, "name": _display_name(name, binary), "pid": pid}


def parse_short_sources(text: str) -> dict[int, str]:
    """pactl list short sources: index → source name."""
    sources = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].strip().isdigit():
            sources[int(parts[0])] = parts[1].strip()
    return sources


def parse_source_outputs_json(text: str, sources: dict[int, str]) -> list[dict]:
    """pactl -f json list source-outputs (pactl 16 and newer)."""
    holders = []
    for out in json.loads(text):
        holder = _holder(out.get("properties") or {}, sources.get(out.get("source")), bool(out.get("corked")))
        if holder:
            holders.append(holder)
    return holders


def parse_source_outputs_text(text: str, sources: dict[int, str]) -> list[dict]:
    """pactl list source-outputs in the C locale (older pactl)."""
    holders = []
    for block in text.split("Source Output #")[1:]:
        source, corked, props = None, False, {}
        for line in block.splitlines():
            stripped = line.strip()
            if stripped.startswith("Source:"):
                value = stripped.split(":", 1)[1].strip()
                source = int(value) if value.isdigit() else None
            elif stripped.startswith("Corked:"):
                corked = stripped.split(":", 1)[1].strip() == "yes"
            elif " = " in stripped:
                key, value = stripped.split(" = ", 1)
                props[key.strip()] = value.strip().strip('"')
        holder = _holder(props, sources.get(source), corked)
        if holder:
            holders.append(holder)
    return holders


class LinuxMicDriver:
    """The recording streams of the sound server; pactl subscribe says when
    they change. Needs pactl (pulseaudio-utils, libpulse on Arch Linux)."""

    names = True
    RETRY_SEC = 5.0

    def available(self) -> bool:
        return shutil.which("pactl") is not None

    def holders(self) -> list[dict]:
        sources = parse_short_sources(_LinuxCapture._pactl("list", "short", "sources") or "")
        out = _LinuxCapture._pactl("-f", "json", "list", "source-outputs")
        if out is not None:
            try:
                return parse_source_outputs_json(out, sources)
            except ValueError:
                pass
        return parse_source_outputs_text(_LinuxCapture._pactl("list", "source-outputs") or "", sources)

    def watch(self, on_change, stop: threading.Event) -> None:
        """Calls on_change() whenever a recording stream comes, goes or
        changes, until stop is set. A sound server that restarts is followed."""
        while not stop.is_set():
            try:
                process = subprocess.Popen(
                    ["pactl", "subscribe"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                    env={**os.environ, "LC_ALL": "C"},
                )
            except OSError as exc:
                log.warning(f"pactl subscribe could not start: {exc}")
                stop.wait(self.RETRY_SEC)
                continue
            ender = threading.Thread(target=lambda: (stop.wait(), process.terminate()), daemon=True)
            ender.start()
            on_change()  # what changed while nothing listened
            for line in process.stdout:
                if "source-output" in line or "'server'" in line:
                    on_change()
            process.wait()
            if not stop.is_set():
                stop.wait(self.RETRY_SEC)


def mic_driver():
    """The driver of this OS, or None where there is none yet."""
    import sys
    if sys.platform.startswith("linux"):
        return LinuxMicDriver()
    return None


# ── The service ──────────────────────────────────────────────────────────────

class MicActivityService:
    def __init__(self, driver, queue, capture, recording, clock=time.monotonic, tick: float = 1.0):
        self._driver = driver
        self._queue = queue
        self._capture = capture
        self._recording = recording
        self._clock = clock
        self._tick = tick
        self._signals = CallSignals()
        self._lock = threading.Lock()
        self._holders: list[dict] | None = None
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def support(self) -> dict:
        available = self._driver is not None and self._driver.available()
        return {"available": available, "names": available and bool(self._driver.names)}

    def holders(self) -> list[dict]:
        with self._lock:
            return list(self._holders or [])

    def refresh(self) -> None:
        try:
            holders = self._driver.holders()
        except Exception as exc:
            log.warning(f"Could not read who holds a microphone: {exc}")
            return
        with self._lock:
            self._holders = holders

    def step(self) -> None:
        """One look at the holders; the signals go to the queue."""
        with self._lock:
            first = self._holders is None
        if first:
            self.refresh()
        own = self._capture.capture_pids() | {os.getpid()}
        holders = [h for h in self.holders() if h.get("pid") not in own]
        recording = self._recording.state() is not None
        for event in self._signals.update(holders, recording, self._clock()):
            self._queue.notify(event)

    def start(self) -> None:
        if not self.support()["available"]:
            log.info("No way to tell here when another app holds a microphone")
            return
        self._stop.clear()
        self.refresh()
        self._threads = [
            threading.Thread(target=self._driver.watch, args=(self.refresh, self._stop), name="mic-watch", daemon=True),
            threading.Thread(target=self._run, name="mic-signals", daemon=True),
        ]
        for thread in self._threads:
            thread.start()

    def stop(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=2)
        self._threads = []

    def _run(self) -> None:
        while not self._stop.wait(self._tick):
            try:
                self.step()
            except Exception as exc:
                log.warning(f"Mic activity step failed: {exc}")
