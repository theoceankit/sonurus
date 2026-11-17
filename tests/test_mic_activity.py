"""MicActivityService: which other apps hold a microphone, and the signals a
call started or ended that come of it. The Linux driver's pactl output is
parsed from fixtures; the service runs on a fake driver and a fake clock."""
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_mic_activity_service
from app.api.main import app
from app.services.mic_activity_service import (
    CallSignals, LinuxMicDriver, MicActivityService, parse_short_sources, parse_source_outputs_json,
    parse_source_outputs_text,
)

SOURCES = "65\talsa_output.usb-Maono.iec958-stereo.monitor\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED\n" \
          "66\talsa_input.usb-Maono.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n"


def _output(index, source, props, corked=False):
    return {"index": index, "driver": "PipeWire", "source": source, "corked": corked, "properties": props}


DISCORD = {"application.name": "WEBRTC VoiceEngine", "application.process.id": "1519731",
           "application.process.binary": "Discord", "media.name": "recStream"}
FIREFOX = {"application.name": "Firefox", "application.process.id": "2200",
           "application.process.binary": "firefox", "media.name": "AudioStream"}
PEAK = {"application.name": "Volume Control", "application.id": "org.PulseAudio.pavucontrol",
        "application.process.id": "3300", "application.process.binary": "pavucontrol", "media.name": "Peak detect"}
OWN_PAREC = {"application.name": "parec", "application.process.id": "4400",
             "application.process.binary": "parec", "media.name": "parec"}


# ── Linux: pactl output ──────────────────────────────────────────────────────

def test_short_sources_map_index_to_name():
    assert parse_short_sources(SOURCES) == {
        65: "alsa_output.usb-Maono.iec958-stereo.monitor", 66: "alsa_input.usb-Maono.analog-stereo",
    }


def test_an_app_recording_a_microphone_holds_it_by_its_program_name():
    text = json.dumps([_output(905, 66, DISCORD)])
    assert parse_source_outputs_json(text, parse_short_sources(SOURCES)) == [
        {"app_id": "discord", "name": "Discord", "pid": 1519731},
    ]


def test_an_app_named_after_itself_keeps_its_name():
    text = json.dumps([_output(906, 66, FIREFOX)])
    assert parse_source_outputs_json(text, parse_short_sources(SOURCES)) == [
        {"app_id": "firefox", "name": "Firefox", "pid": 2200},
    ]


@pytest.mark.parametrize("output", [
    _output(907, 65, FIREFOX),               # records what plays, not a microphone
    _output(908, 66, PEAK),                  # a level meter
    _output(909, 66, DISCORD, corked=True),  # paused
])
def test_what_is_not_an_app_holding_a_microphone_is_left_out(output):
    assert parse_source_outputs_json(json.dumps([output]), parse_short_sources(SOURCES)) == []


def test_older_pactl_text_gives_the_same_holders():
    text = """Source Output #905
	Driver: PipeWire
	Owner Module: n/a
	Client: 859
	Source: 66
	Sample Specification: s16le 2ch 48000Hz
	Corked: no
	Mute: no
	Properties:
		application.name = "WEBRTC VoiceEngine"
		application.process.id = "1519731"
		application.process.binary = "Discord"
		media.name = "recStream"

Source Output #908
	Driver: PipeWire
	Source: 66
	Corked: no
	Properties:
		application.name = "Volume Control"
		application.id = "org.PulseAudio.pavucontrol"
		application.process.id = "3300"
		media.name = "Peak detect"

Source Output #909
	Driver: PipeWire
	Source: 65
	Corked: no
	Properties:
		application.name = "Firefox"
		application.process.id = "2200"
		application.process.binary = "firefox"
"""
    assert parse_source_outputs_text(text, parse_short_sources(SOURCES)) == [
        {"app_id": "discord", "name": "Discord", "pid": 1519731},
    ]


def test_without_pactl_the_linux_driver_is_not_available(monkeypatch):
    monkeypatch.setattr("app.services.mic_activity_service.shutil.which", lambda name: None)
    assert not LinuxMicDriver().available()


# ── Call signals ─────────────────────────────────────────────────────────────

D = {"app_id": "discord", "name": "Discord", "pid": 10}
F = {"app_id": "firefox", "name": "Firefox", "pid": 20}


def test_an_app_holding_a_microphone_15_seconds_is_a_call_that_started():
    signals = CallSignals()
    assert signals.update([D], recording=False, now=100.0) == []
    assert signals.update([D], recording=False, now=114.9) == []
    assert signals.update([D], recording=False, now=115.0) == [
        {"type": "mic_app_active", "app_id": "discord", "name": "Discord"},
    ]


def test_one_signal_per_hold_until_the_app_lets_go_and_takes_it_again():
    signals = CallSignals()
    signals.update([D], recording=False, now=0.0)
    assert signals.update([D], recording=False, now=15.0)
    assert signals.update([D], recording=False, now=200.0) == []
    signals.update([], recording=False, now=201.0)
    signals.update([D], recording=False, now=202.0)
    assert signals.update([D], recording=False, now=217.0) == [
        {"type": "mic_app_active", "app_id": "discord", "name": "Discord"},
    ]


def test_a_hold_that_breaks_starts_again():
    signals = CallSignals()
    signals.update([D], recording=False, now=0.0)
    signals.update([], recording=False, now=10.0)
    signals.update([D], recording=False, now=11.0)
    assert signals.update([D], recording=False, now=25.0) == []
    assert signals.update([D], recording=False, now=26.0)


def test_no_start_signal_while_recording_nor_after_it_for_the_same_hold():
    signals = CallSignals()
    signals.update([D], recording=True, now=0.0)
    assert signals.update([D], recording=True, now=20.0) == []
    assert signals.update([D], recording=False, now=40.0) == []


def test_the_call_ends_when_every_other_app_let_go_of_the_microphone_for_15_seconds():
    signals = CallSignals()
    signals.update([D, F], recording=True, now=0.0)
    signals.update([D], recording=True, now=60.0)
    assert signals.update([D], recording=True, now=100.0) == []
    signals.update([], recording=True, now=120.0)
    assert signals.update([], recording=True, now=134.9) == []
    assert signals.update([], recording=True, now=135.0) == [{"type": "call_ended", "reason": "mic_released"}]
    assert signals.update([], recording=True, now=300.0) == []


def test_no_end_signal_when_no_other_app_held_the_microphone_during_the_recording():
    signals = CallSignals()
    signals.update([], recording=True, now=0.0)
    assert signals.update([], recording=True, now=100.0) == []


def test_the_end_counts_again_when_an_app_takes_the_microphone_again():
    signals = CallSignals()
    signals.update([D], recording=True, now=0.0)
    signals.update([], recording=True, now=10.0)
    assert signals.update([], recording=True, now=25.0)
    signals.update([D], recording=True, now=30.0)
    signals.update([], recording=True, now=40.0)
    assert signals.update([], recording=True, now=55.0) == [{"type": "call_ended", "reason": "mic_released"}]


def test_a_new_recording_starts_with_nothing_held():
    signals = CallSignals()
    signals.update([D], recording=True, now=0.0)
    signals.update([], recording=False, now=10.0)
    signals.update([], recording=True, now=11.0)
    assert signals.update([], recording=True, now=100.0) == []


# ── The service ──────────────────────────────────────────────────────────────

class FakeDriver:
    names = True

    def __init__(self, holders=(), available=True):
        self.current = list(holders)
        self._available = available
        self.watching = threading.Event()
        self.stopped = threading.Event()

    def available(self):
        return self._available

    def holders(self):
        return list(self.current)

    def watch(self, on_change, stop):
        self.on_change = on_change
        self.watching.set()
        stop.wait()
        self.stopped.set()


class FakeQueue:
    def __init__(self):
        self.events = []

    def notify(self, event):
        self.events.append(event)


class FakeCapturePids:
    def __init__(self, pids=()):
        self.pids = set(pids)

    def capture_pids(self):
        return set(self.pids)


class FakeRecording:
    def __init__(self):
        self.live = False

    def state(self):
        return {"phase": "live"} if self.live else None


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def _service(driver, capture=None, recording=None, clock=None):
    return MicActivityService(driver, FakeQueue(), capture or FakeCapturePids(), recording or FakeRecording(),
                              clock=clock or Clock(), tick=0.01)


def test_the_service_tells_the_queue_of_an_app_that_holds_the_microphone():
    clock = Clock()
    service = _service(FakeDriver([D]), clock=clock)
    service.step()
    clock.now = 15.0
    service.step()
    assert service._queue.events == [{"type": "mic_app_active", "app_id": "discord", "name": "Discord"}]


def test_the_start_signal_matches_its_model():
    from app.api.schemas import CallEndedEvent, MicAppActiveEvent
    signals = CallSignals()
    signals.update([D], recording=False, now=0.0)
    [started] = signals.update([D], recording=False, now=15.0)
    assert MicAppActiveEvent.model_validate(started).model_dump() == started
    signals.update([D], recording=True, now=20.0)
    signals.update([], recording=True, now=21.0)
    [ended] = signals.update([], recording=True, now=36.0)
    assert CallEndedEvent.model_validate(ended).model_dump() == ended


def test_the_captures_of_sonorus_are_not_other_apps():
    clock = Clock()
    service = _service(FakeDriver([D]), capture=FakeCapturePids({10}), clock=clock)
    service.step()
    clock.now = 30.0
    service.step()
    assert service._queue.events == []


def test_the_service_reads_the_holders_again_when_the_driver_says_they_changed():
    driver = FakeDriver([])
    service = _service(driver)
    service.start()
    try:
        assert driver.watching.wait(2)
        driver.current = [D]
        driver.on_change()
        deadline = time.time() + 2
        while service.holders() != [D] and time.time() < deadline:
            time.sleep(0.01)
        assert service.holders() == [D]
    finally:
        service.stop()
    assert driver.stopped.is_set()


def test_without_a_signal_the_service_does_not_watch():
    driver = FakeDriver(available=False)
    service = _service(driver)
    service.start()
    service.stop()
    assert not driver.watching.is_set()
    assert service.support() == {"available": False, "names": False}


def test_the_route_says_whether_there_is_a_signal_and_whether_it_names_the_app():
    app.dependency_overrides[get_mic_activity_service] = lambda: _service(FakeDriver())
    try:
        assert TestClient(app).get("/audio/mic-watch").json() == {"available": True, "names": True}
    finally:
        app.dependency_overrides.pop(get_mic_activity_service, None)
