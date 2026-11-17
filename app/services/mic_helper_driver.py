"""Who holds a microphone, as the bundled capture helper reports it.

On macOS and Windows the sonorus-capture helper watches the microphone itself:
`sonorus-capture --watch-mic` prints one JSON object per line, the first at
start and then one at every change, each the whole current state:

    {"names": true, "holders": [{"pid": 1234, "app_id": "us.zoom.xos", "name": "Zoom"}]}

`names` says whether the system tells which app holds a microphone (macOS
before 14.2 only knows that some process uses an input device: one holder
without an app_id or a name). The helper stops on "stop" on stdin or at EOF.
It reads only local system state: no network, no permission prompt.
"""
import json
import os
import subprocess
import threading

from app.logger import get_logger

log = get_logger("MicActivity")

# The app_id of a holder the system does not name.
UNNAMED_APP = "microphone"


def _holder(entry) -> dict | None:
    if not isinstance(entry, dict):
        return None
    name = entry.get("name") if isinstance(entry.get("name"), str) and entry.get("name").strip() else None
    app_id = entry.get("app_id") if isinstance(entry.get("app_id"), str) and entry.get("app_id").strip() else None
    pid = entry.get("pid")
    pid = pid if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0 else None
    return {"app_id": app_id or name or UNNAMED_APP, "name": name, "pid": pid}


def parse_helper_line(line: str) -> dict | None:
    """One line of the helper: {"names", "holders"}, or None for anything else."""
    try:
        data = json.loads(line)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("holders"), list):
        return None
    holders = [h for h in (_holder(e) for e in data["holders"]) if h is not None]
    return {"names": data.get("names") is not False, "holders": holders}


class HelperMicDriver:
    """The holders the helper reported last; it says itself when they change."""

    RETRY_SEC = 5.0
    STOP_TIMEOUT_SEC = 2.0

    def __init__(self, binary: str | None, names: bool = True):
        self.binary = binary
        self._names = names
        self._holders: list[dict] = []
        self._lock = threading.Lock()

    @property
    def names(self) -> bool:
        with self._lock:
            return self._names

    def available(self) -> bool:
        return bool(self.binary) and os.path.isfile(self.binary)

    def holders(self) -> list[dict]:
        with self._lock:
            return list(self._holders)

    def _take(self, line: dict, own_pid: int | None) -> None:
        with self._lock:
            self._names = line["names"]
            self._holders = [h for h in line["holders"] if own_pid is None or h["pid"] != own_pid]

    def watch(self, on_change, stop: threading.Event) -> None:
        """Calls on_change() after every line of the helper, until stop is set.
        A helper that exits is started again; what it said last stays meanwhile."""
        while not stop.is_set():
            try:
                process = subprocess.Popen(
                    [self.binary, "--watch-mic"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                )
            except OSError as exc:
                log.warning(f"sonorus-capture --watch-mic could not start: {exc}")
                stop.wait(self.RETRY_SEC)
                continue
            ender = threading.Thread(target=self._end, args=(process, stop), daemon=True)
            ender.start()
            for raw in process.stdout:
                line = parse_helper_line(raw.strip())
                if line is None:
                    continue
                self._take(line, process.pid)
                on_change()
            process.wait()
            if not stop.is_set():
                log.warning(f"sonorus-capture --watch-mic exited ({process.returncode}); starting it again")
                stop.wait(self.RETRY_SEC)

    def _end(self, process: subprocess.Popen, stop: threading.Event) -> None:
        while not stop.wait(0.5):
            if process.poll() is not None:
                return
        try:
            process.stdin.write("stop\n")
            process.stdin.flush()
            process.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            process.wait(timeout=self.STOP_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            process.terminate()
