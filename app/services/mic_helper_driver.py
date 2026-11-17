"""Who holds a microphone, as the bundled sonorus-capture helper reports it.

On Windows and macOS the helper that records also watches the microphones:
`sonorus-capture --watch-mic` prints one JSON object per line, the first at
start and then one whenever the holders change:

    {"names": true, "holders": [{"pid": 1234, "app_id": "zoom", "name": "Zoom"}]}

`app_id` is the program (the lowercased exe name without its extension on
Windows), `name` the one to show or null, `names` whether the helper can
tell apps apart by name at all. The helper stops on a "stop" line or EOF on
stdin, as when it records. Other lines (warnings) are ignored.
"""
import json
import subprocess
import threading
from pathlib import Path

from app.logger import get_logger

log = get_logger("MicActivity")

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_STOP_TIMEOUT_SEC = 2.0


def parse_helper_line(line: str) -> dict | None:
    """One line of --watch-mic: {"names", "holders": [{app_id, name, pid}]},
    or None if it is not a holders line."""
    try:
        data = json.loads(line)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("holders"), list):
        return None
    holders = []
    for entry in data["holders"]:
        if not isinstance(entry, dict):
            continue
        app_id = entry.get("app_id")
        if not isinstance(app_id, str) or not app_id:
            continue
        name = entry.get("name")
        pid = entry.get("pid")
        holders.append({
            "app_id": app_id,
            "name": name if isinstance(name, str) and name else None,
            "pid": pid if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0 else None,
        })
    return {"names": bool(data.get("names", True)), "holders": holders}


class HelperMicDriver:
    """The holders the helper last reported; watch() keeps it running and
    starts it again if it ends."""

    RETRY_SEC = 5.0

    def __init__(self, helper_bin: str | None, names: bool = True):
        self.helper_bin = helper_bin
        self.names = names
        self._holders: list[dict] = []
        self._lock = threading.Lock()

    def available(self) -> bool:
        return bool(self.helper_bin) and Path(self.helper_bin).is_file()

    def holders(self) -> list[dict]:
        with self._lock:
            return list(self._holders)

    def watch(self, on_change, stop: threading.Event) -> None:
        """Calls on_change() after each holders line, until stop is set."""
        while not stop.is_set():
            try:
                process = subprocess.Popen(
                    [self.helper_bin, "--watch-mic"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, encoding="utf-8", errors="replace", creationflags=_NO_WINDOW,
                )
            except OSError as exc:
                log.warning(f"The microphone watch could not start: {exc}")
                with self._lock:
                    self._holders = []
                stop.wait(self.RETRY_SEC)
                continue
            ender = threading.Thread(target=self._end, args=(process, stop), daemon=True)
            ender.start()
            for line in process.stdout:
                state = parse_helper_line(line)
                if state is None:
                    continue
                with self._lock:
                    self._holders = state["holders"]
                self.names = state["names"]
                on_change()
            process.wait()
            if not stop.is_set():
                log.warning(f"The microphone watch ended (code {process.returncode}); starting it again")
                stop.wait(self.RETRY_SEC)

    @staticmethod
    def _end(process: subprocess.Popen, stop: threading.Event) -> None:
        while not stop.wait(0.5):
            if process.poll() is not None:
                return
        try:
            process.stdin.write("stop\n")
            process.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            process.wait(timeout=_STOP_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            process.kill()
