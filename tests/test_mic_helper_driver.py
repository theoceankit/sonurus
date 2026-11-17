"""HelperMicDriver: the holders of a microphone as the capture helper reports
them (sonorus-capture --watch-mic on macOS and Windows), one JSON object per
line. The lines are parsed from fixtures; watch() runs a stand-in helper, a
Python script, so no Mac or Windows is needed."""
import json
import os
import sys
import threading
import time
from unittest.mock import patch

import pytest

from app.services.mic_activity_service import CallSignals, MicActivityService, mic_driver
from app.services.mic_helper_driver import HelperMicDriver, parse_helper_line

ZOOM = {"pid": 1234, "app_id": "us.zoom.xos", "name": "Zoom"}
FACETIME = {"pid": 77, "app_id": "com.apple.FaceTime", "name": "FaceTime"}


def _line(holders, names=True):
    return json.dumps({"names": names, "holders": holders})


# ── One line ─────────────────────────────────────────────────────────────────

def test_a_line_gives_the_holders_and_whether_they_are_named():
    assert parse_helper_line(_line([ZOOM, FACETIME])) == {
        "names": True,
        "holders": [{"app_id": "us.zoom.xos", "name": "Zoom", "pid": 1234},
                    {"app_id": "com.apple.FaceTime", "name": "FaceTime", "pid": 77}],
    }


def test_nobody_holding_the_microphone_is_an_empty_list():
    assert parse_helper_line(_line([])) == {"names": True, "holders": []}


def test_a_holder_without_a_name_is_kept_under_its_app_id():
    [holder] = parse_helper_line(_line([{"pid": 9, "app_id": "com.example.tool", "name": None}]))["holders"]
    assert holder == {"app_id": "com.example.tool", "name": None, "pid": 9}


def test_an_unnamed_microphone_user_is_one_holder():
    # macOS before 14.2: some process uses an input device, which one is not known.
    line = parse_helper_line(_line([{"pid": None, "app_id": None, "name": None}], names=False))
    assert line == {"names": False, "holders": [{"app_id": "microphone", "name": None, "pid": None}]}


@pytest.mark.parametrize("text", ["", "READY", "{not json", "[1, 2]", '{"holders": 3}', "null"])
def test_what_is_not_a_line_of_holders_is_ignored(text):
    assert parse_helper_line(text) is None


def test_entries_that_are_not_holders_are_dropped():
    line = _line([ZOOM, "Zoom", 3, {"pid": "x", "app_id": "a.b", "name": 5}])
    assert parse_helper_line(line)["holders"] == [
        {"app_id": "us.zoom.xos", "name": "Zoom", "pid": 1234},
        {"app_id": "a.b", "name": None, "pid": None},
    ]


# ── The driver ───────────────────────────────────────────────────────────────

def _helper(tmp_path, lines, *, then="wait"):
    """A stand-in for sonorus-capture: prints lines when started with
    --watch-mic, then waits for "stop" on stdin (or exits at once)."""
    script = tmp_path / "sonorus-capture"
    log = tmp_path / "calls.log"
    script.write_text(
        f"#!{sys.executable}\n"
        "import sys, os\n"
        f"open({str(log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
        f"for line in {list(lines)!r}:\n"
        "    print(line, flush=True)\n"
        + ("for line in sys.stdin:\n"
           "    if line.strip() == 'stop':\n"
           f"        open({str(log)!r}, 'a').write('stop\\n')\n"
           "        break\n" if then == "wait" else "")
    )
    script.chmod(0o755)
    return script, log


def _wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while not predicate() and time.time() < deadline:
        time.sleep(0.01)
    return predicate()


def test_the_driver_is_available_where_the_helper_is(tmp_path):
    script, _ = _helper(tmp_path, [])
    assert HelperMicDriver(str(script)).available()
    assert not HelperMicDriver(str(tmp_path / "missing")).available()
    assert not HelperMicDriver(None).available()


def test_names_follow_what_the_helper_says_and_start_from_the_os(tmp_path):
    script, _ = _helper(tmp_path, [_line([], names=False)])
    driver = HelperMicDriver(str(script), names=True)
    assert driver.names is True
    stop = threading.Event()
    changed = threading.Event()
    thread = threading.Thread(target=driver.watch, args=(changed.set, stop))
    thread.start()
    try:
        assert changed.wait(5)
        assert driver.names is False
    finally:
        stop.set()
        thread.join(5)


def test_watch_reports_each_change_and_stops_the_helper_through_stdin(tmp_path):
    script, log = _helper(tmp_path, [_line([]), "noise", _line([ZOOM]), _line([ZOOM, FACETIME])])
    driver = HelperMicDriver(str(script))
    assert driver.holders() == []
    seen = []
    stop = threading.Event()
    thread = threading.Thread(target=driver.watch, args=(lambda: seen.append(driver.holders()), stop))
    thread.start()
    try:
        assert _wait_for(lambda: len(seen) == 3)
        assert seen[0] == []
        assert [h["app_id"] for h in seen[1]] == ["us.zoom.xos"]
        assert [h["app_id"] for h in seen[2]] == ["us.zoom.xos", "com.apple.FaceTime"]
    finally:
        stop.set()
        thread.join(5)
    assert not thread.is_alive()
    assert log.read_text().splitlines() == ["--watch-mic", "stop"]


def test_a_helper_that_exits_is_started_again(tmp_path, monkeypatch):
    monkeypatch.setattr(HelperMicDriver, "RETRY_SEC", 0.05)
    script, log = _helper(tmp_path, [_line([ZOOM])], then="exit")
    driver = HelperMicDriver(str(script))
    stop = threading.Event()
    thread = threading.Thread(target=driver.watch, args=(lambda: None, stop))
    thread.start()
    try:
        assert _wait_for(lambda: log.exists() and log.read_text().count("--watch-mic") >= 2)
        # What was last known stays while the helper is down.
        assert [h["app_id"] for h in driver.holders()] == ["us.zoom.xos"]
    finally:
        stop.set()
        thread.join(5)
    assert not thread.is_alive()


def test_a_helper_that_cannot_start_is_tried_again(tmp_path, monkeypatch):
    monkeypatch.setattr(HelperMicDriver, "RETRY_SEC", 0.01)
    script = tmp_path / "not-executable"
    script.write_text("")
    driver = HelperMicDriver(str(script))
    stop = threading.Event()
    thread = threading.Thread(target=driver.watch, args=(lambda: None, stop))
    thread.start()
    time.sleep(0.1)
    stop.set()
    thread.join(5)
    assert not thread.is_alive()


def test_the_watcher_itself_is_not_a_holder(tmp_path):
    script, _ = _helper(tmp_path, [])
    driver = HelperMicDriver(str(script))
    driver._take(parse_helper_line(_line([ZOOM, {"pid": 4321, "app_id": "watcher", "name": None}])), own_pid=4321)
    assert [h["app_id"] for h in driver.holders()] == ["us.zoom.xos"]


# ── Which driver ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("version, names", [("14.2", True), ("15.1", True), ("14.1.2", False), ("13.6", False)])
def test_on_macos_the_helper_watches_and_names_apps_from_14_2(version, names):
    with patch("app.services.mic_activity_service.sys.platform", "darwin"), \
         patch("app.services.mic_activity_service.platform.mac_ver", return_value=(version, ("", "", ""), "")), \
         patch("app.services.mic_activity_service._capture_bin", return_value="/opt/sonorus-capture"):
        driver = mic_driver()
    assert isinstance(driver, HelperMicDriver)
    assert driver.binary == "/opt/sonorus-capture"
    assert driver.names is names


# ── Without names (macOS before 14.2) ────────────────────────────────────────

ANYONE = {"app_id": "microphone", "name": None, "pid": None}


def test_without_names_a_call_still_starts_but_the_mic_released_end_never_comes():
    signals = CallSignals()
    signals.update([ANYONE], recording=False, now=0.0, names=False)
    assert signals.update([ANYONE], recording=False, now=15.0, names=False) == [
        {"type": "mic_app_active", "app_id": "microphone", "name": None}]
    # Sonorus' own microphone is one of the unnamed users: letting go says nothing.
    signals.update([ANYONE], recording=True, now=20.0, names=False)
    signals.update([], recording=True, now=30.0, names=False)
    assert signals.update([], recording=True, now=60.0, names=False) == []


class _UnnamedDriver:
    names = False

    def available(self):
        return True

    def holders(self):
        return self.current

    def watch(self, on_change, stop):
        stop.wait()


class _Queue:
    def __init__(self):
        self.events = []

    def notify(self, event):
        self.events.append(event)


class _Pids:
    def capture_pids(self):
        return set()


class _Recording:
    live = False

    def state(self):
        return {"phase": "live"} if self.live else None


def test_the_service_turns_off_the_mic_released_end_when_the_driver_names_no_apps():
    now = [0.0]
    driver, queue, recording = _UnnamedDriver(), _Queue(), _Recording()
    driver.current = [ANYONE]
    service = MicActivityService(driver, queue, _Pids(), recording, clock=lambda: now[0], tick=0.01)
    recording.live = True
    service.step()
    driver.current = []
    service.refresh()
    for t in (1.0, 20.0, 40.0):
        now[0] = t
        service.step()
    assert queue.events == []
    assert service.support() == {"available": True, "names": False}
