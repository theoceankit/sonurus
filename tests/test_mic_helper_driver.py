"""HelperMicDriver: who holds a microphone on Windows and macOS, as the bundled
sonorus-capture helper reports it with --watch-mic. The lines are parsed from
fixtures; the watch runs a stand-in helper script, so no Windows is needed."""
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.mic_activity_service import CallSignals, LinuxMicDriver, MicActivityService, mic_driver
from app.services.mic_helper_driver import HelperMicDriver, parse_helper_line

ZOOM_LINE = '{"names": true, "holders": [{"pid": 1234, "app_id": "zoom", "name": "Zoom Meetings"}]}'


# ── The lines of the helper ──────────────────────────────────────────────────

def test_a_line_gives_the_holders_and_whether_they_are_named():
    assert parse_helper_line(ZOOM_LINE) == {
        "names": True, "holders": [{"app_id": "zoom", "name": "Zoom Meetings", "pid": 1234}],
    }


def test_nobody_holding_a_microphone_is_an_empty_list():
    assert parse_helper_line('{"names": true, "holders": []}\r\n') == {"names": True, "holders": []}


def test_a_holder_without_a_name_keeps_none():
    line = '{"names": false, "holders": [{"pid": null, "app_id": "unknown", "name": null}]}'
    assert parse_helper_line(line) == {
        "names": False, "holders": [{"app_id": "unknown", "name": None, "pid": None}],
    }


def test_a_holder_without_an_app_id_is_left_out():
    line = '{"names": true, "holders": [{"pid": 5, "app_id": "", "name": "X"}, {"pid": 6, "name": "Y"},' \
           ' {"pid": 7, "app_id": "teams", "name": "Microsoft Teams"}]}'
    assert parse_helper_line(line)["holders"] == [{"app_id": "teams", "name": "Microsoft Teams", "pid": 7}]


def test_a_pid_that_is_not_a_number_is_none():
    line = '{"names": true, "holders": [{"pid": "x", "app_id": "chrome", "name": "Google Chrome"}]}'
    assert parse_helper_line(line)["holders"] == [{"app_id": "chrome", "name": "Google Chrome", "pid": None}]


@pytest.mark.parametrize("line", [
    "",
    "WARNING: the input device was lost",
    "{not json",
    "[]",
    '{"names": true}',
    '{"names": true, "holders": {}}',
])
def test_what_is_not_a_holders_line_is_ignored(line):
    assert parse_helper_line(line) is None


# ── The driver ───────────────────────────────────────────────────────────────

def test_without_the_helper_the_driver_is_not_available(tmp_path):
    assert not HelperMicDriver(None).available()
    assert not HelperMicDriver(str(tmp_path / "missing.exe")).available()


def test_with_the_helper_the_driver_is_available_and_names_apps(tmp_path):
    helper = tmp_path / "sonorus-capture.exe"
    helper.write_bytes(b"")
    driver = HelperMicDriver(str(helper))
    assert driver.available()
    assert driver.names is True
    assert driver.holders() == []


def test_windows_watches_through_the_capture_helper(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    driver = mic_driver("C:/Sonorus/resources/win/sonorus-capture.exe")
    assert isinstance(driver, HelperMicDriver)
    assert driver.helper_bin == "C:/Sonorus/resources/win/sonorus-capture.exe"


@pytest.mark.parametrize("version, names", [("14.2", True), ("15.1", True), ("14.1.2", False), ("13.6", False)])
def test_macos_watches_through_the_capture_helper_and_names_apps_from_14_2(monkeypatch, version, names):
    monkeypatch.setattr(sys, "platform", "darwin")
    with patch("app.services.mic_activity_service.platform.mac_ver", return_value=(version, ("", "", ""), "")):
        driver = mic_driver("/Applications/Sonorus.app/Contents/Resources/mac/sonorus-capture")
    assert isinstance(driver, HelperMicDriver)
    assert driver.helper_bin == "/Applications/Sonorus.app/Contents/Resources/mac/sonorus-capture"
    assert driver.names is names


def test_an_unnamed_microphone_user_is_one_holder():
    # macOS before 14.2: some process uses an input device, which one is not known.
    line = '{"names": false, "holders": [{"pid": null, "app_id": "microphone", "name": null}]}'
    assert parse_helper_line(line) == {
        "names": False, "holders": [{"app_id": "microphone", "name": None, "pid": None}],
    }


def test_linux_still_watches_through_pactl(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    assert isinstance(mic_driver("/whatever"), LinuxMicDriver)


# A stand-in for sonorus-capture --watch-mic: prints the lines it is given,
# then waits for "stop" or EOF on stdin and leaves a mark that it was told.
FAKE_HELPER = '''#!{python}
import sys, pathlib
mark = pathlib.Path({mark!r})
assert sys.argv[1:] == ["--watch-mic"], sys.argv
for line in {lines!r}:
    print(line, flush=True)
if {exit_at_once!r}:
    mark.write_text(mark.read_text() + "exited\\n" if mark.exists() else "exited\\n")
    sys.exit(0)
for line in sys.stdin:
    if "stop" in line:
        break
mark.write_text("stopped\\n")
'''


def _fake_helper(tmp_path: Path, lines, exit_at_once=False) -> tuple[str, Path]:
    mark = tmp_path / "mark"
    script = tmp_path / "sonorus-capture"
    script.write_text(FAKE_HELPER.format(python=sys.executable, mark=str(mark), lines=list(lines),
                                         exit_at_once=exit_at_once))
    script.chmod(0o755)
    return str(script), mark


def _wait(condition, timeout=5.0):
    deadline = time.time() + timeout
    while not condition() and time.time() < deadline:
        time.sleep(0.01)
    return condition()


def test_the_watch_reports_each_line_and_stops_the_helper(tmp_path):
    lines = [
        '{"names": true, "holders": []}',
        "WARNING: something the driver does not read",
        ZOOM_LINE,
    ]
    helper, mark = _fake_helper(tmp_path, lines)
    driver = HelperMicDriver(helper)
    changes = []
    stop = threading.Event()
    watcher = threading.Thread(target=driver.watch, args=(lambda: changes.append(driver.holders()), stop))
    watcher.start()
    try:
        assert _wait(lambda: len(changes) == 2)
        assert changes == [[], [{"app_id": "zoom", "name": "Zoom Meetings", "pid": 1234}]]
        assert driver.holders() == [{"app_id": "zoom", "name": "Zoom Meetings", "pid": 1234}]
    finally:
        stop.set()
        watcher.join(5)
    assert not watcher.is_alive()
    assert _wait(lambda: mark.exists() and mark.read_text() == "stopped\n")


def test_the_names_flag_follows_the_helper(tmp_path):
    helper, _ = _fake_helper(tmp_path, ['{"names": false, "holders": []}'])
    driver = HelperMicDriver(helper)
    stop = threading.Event()
    watcher = threading.Thread(target=driver.watch, args=(lambda: None, stop))
    watcher.start()
    try:
        assert _wait(lambda: driver.names is False)
    finally:
        stop.set()
        watcher.join(5)


def test_a_helper_that_exits_is_started_again(tmp_path, monkeypatch):
    monkeypatch.setattr(HelperMicDriver, "RETRY_SEC", 0.05)
    helper, mark = _fake_helper(tmp_path, [ZOOM_LINE], exit_at_once=True)
    driver = HelperMicDriver(helper)
    stop = threading.Event()
    watcher = threading.Thread(target=driver.watch, args=(lambda: None, stop))
    watcher.start()
    try:
        assert _wait(lambda: mark.exists() and mark.read_text().count("exited") >= 2)
    finally:
        stop.set()
        watcher.join(5)
    assert not watcher.is_alive()


def test_a_helper_that_cannot_start_is_tried_again(tmp_path, monkeypatch):
    monkeypatch.setattr(HelperMicDriver, "RETRY_SEC", 0.05)
    driver = HelperMicDriver(str(tmp_path / "not-executable"))
    (tmp_path / "not-executable").write_text("")
    stop = threading.Event()
    watcher = threading.Thread(target=driver.watch, args=(lambda: None, stop))
    watcher.start()
    time.sleep(0.2)
    stop.set()
    watcher.join(5)
    assert not watcher.is_alive()
    assert driver.holders() == []


def test_the_service_builds_the_driver_from_the_capture_helper(monkeypatch):
    """The backend hands the helper it records with to the watch as well."""
    import app.api.dependencies as deps
    seen = {}

    def fake_mic_driver(capture_bin=None):
        seen["bin"] = capture_bin
        return None

    monkeypatch.setattr(deps, "mic_driver", fake_mic_driver)
    deps.get_mic_activity_service.cache_clear()
    try:
        deps.get_mic_activity_service()
    finally:
        deps.get_mic_activity_service.cache_clear()
    assert seen["bin"] == deps.get_audio_capture_service().capture_bin



def test_the_watcher_itself_is_not_a_holder(tmp_path):
    helper = tmp_path / "sonorus-capture"
    helper.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "print('{\"names\": true, \"holders\": [{\"pid\": 1234, \"app_id\": \"zoom\", \"name\": \"Zoom\"},'"
        " ' {\"pid\": %d, \"app_id\": \"watcher\", \"name\": null}]}' % os.getpid(), flush=True)\n"
        "sys.stdin.read()\n"
    )
    helper.chmod(0o755)
    driver = HelperMicDriver(str(helper))
    stop = threading.Event()
    changed = threading.Event()
    watcher = threading.Thread(target=driver.watch, args=(changed.set, stop))
    watcher.start()
    try:
        assert changed.wait(5)
        assert [h["app_id"] for h in driver.holders()] == ["zoom"]
    finally:
        stop.set()
        watcher.join(5)


# ── Without names (macOS before 14.2) ────────────────────────────────────────

ANYONE = {"app_id": "microphone", "name": None, "pid": None}


def test_without_names_a_call_still_starts_but_the_mic_released_end_never_comes():
    signals = CallSignals()
    signals.update([ANYONE], recording=False, now=0.0, names=False)
    assert signals.update([ANYONE], recording=False, now=15.0, names=False) == [
        {"type": "mic_app_active", "app_id": "microphone", "name": None}]
    # The microphone of Sonorus is one of the unnamed users: letting go says nothing.
    signals.update([ANYONE], recording=True, now=20.0, names=False)
    signals.update([], recording=True, now=30.0, names=False)
    assert signals.update([], recording=True, now=60.0, names=False) == []


class _UnnamedDriver:
    names = False
    current = [ANYONE]

    def available(self):
        return True

    def holders(self):
        return list(self.current)

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
    def state(self):
        return {"phase": "live"}


def test_the_service_turns_off_the_mic_released_end_when_the_driver_names_no_apps():
    now = [0.0]
    driver, queue = _UnnamedDriver(), _Queue()
    service = MicActivityService(driver, queue, _Pids(), _Recording(), clock=lambda: now[0], tick=0.01)
    service.step()
    driver.current = []
    service.refresh()
    for t in (1.0, 20.0, 40.0):
        now[0] = t
        service.step()
    assert queue.events == []
    assert service.support() == {"available": True, "names": False}
