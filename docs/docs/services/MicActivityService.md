---
sidebar_position: 14
---

# Mic Activity Service

`app/services/mic_activity_service.py` (`MicActivityService`) watches which other apps hold a microphone and tells when a call may have started or ended. It only tells: the Electron main process turns its events into notifications, or stops the recording, as the user's settings say ([Live Recording → Calls](../ui/electron/live-recording.md#calls-starting-and-ending)). Nothing records without the user.

One instance (`get_mic_activity_service()` in `app/api/dependencies.py`) is started and stopped by the app lifespan. `SONORUS_MIC_WATCH=0` keeps it from starting; the tests set it.

---

## Signals

A driver per OS reports the holders of a microphone, `{app_id, name, pid}` each. The capture processes of Sonorus (`AudioCaptureService.capture_pids()`) and the backend itself are left out. `CallSignals`, pure and given the clock, turns what is left into two events, sent as queue events over `WS /ws/queue` (`TranscriptionQueue.notify()`):

| Event | When |
|---|---|
| `mic_app_active {app_id, name}` | An app held a microphone 15 s without a break while no recording runs. Once per hold: told again only after the app lets go and takes the microphone again. A hold that reaches 15 s during a recording is not told after it either. Two streams of one app are one hold (`app_id`). |
| `call_ended {reason: "mic_released"}` | During a recording another app held a microphone, and now none has for 15 s. Once, until an app takes the microphone again. A recording during which no other app held a microphone (a meeting in the room) never ends this way. Not where the driver names no apps (`names` false, macOS before 14.2): there the capture of Sonorus cannot be told from other apps. |

The other end of a call, `call_ended {reason: "silence"}`, comes from [LiveRecordingService](./LiveRecordingService.md): no track had sound for 5 minutes.

`GET /audio/mic-watch` says whether there is a signal on this system (`available`) and whether it names the app (`names`), for Settings → Notifications.

---

## Drivers

| OS | Driver | Notes |
|---|---|---|
| Linux | `LinuxMicDriver` | `pactl subscribe` says when a recording stream comes, goes or changes; `pactl -f json list source-outputs` (the text list for pactl older than 16) and `pactl list short sources` say who records what. Left out: streams of a monitor source (they record what plays), paused (corked) streams, level meters (`Peak detect` of pavucontrol, `stream.monitor`). The name is `application.name`, or the program (`application.process.binary`) when the name says how rather than who (`WEBRTC VoiceEngine` of Discord, `ZOOM VoiceEngine`); `app_id` is the program. A browser is one app for all its tabs. A sound server that restarts is followed after 5 s. Needs `pactl` (`pulseaudio-utils`, `libpulse` on Arch Linux), as recording does. |
| macOS 14.2 and newer | `HelperMicDriver` | `sonorus-capture --watch-mic` reads CoreAudio: the process objects (`kAudioHardwarePropertyProcessObjectList`) that run input (`kAudioProcessPropertyIsRunningInput`), with listeners on both and a look every 2 s. `app_id` is the bundle id of the outermost `.app` on the process's path, so the audio helper of a browser counts as the browser, and `name` its display name; a process outside an app is named by its executable. No permission is needed. |
| macOS before 14.2 | `HelperMicDriver` | The same mode can only see that some process runs an input device (`kAudioDevicePropertyDeviceIsRunningSomewhere`): one holder with neither app_id nor name (`app_id` `microphone`), `names` false. A call starts without the app's name; the `mic_released` end is off, the end by silence stays. A device that also plays (some headsets) counts while it plays. |
| Windows | — | No driver yet: `available` is false and Settings marks the start of a call as not available. The end of a call by silence works. |

`HelperMicDriver` (`app/services/mic_helper_driver.py`) runs the helper (`SONORUS_CAPTURE_BIN`, or `electron/resources/mac/sonorus-capture` in dev) and reads one JSON object per line, the first at start and one at every change, each the whole state:

```json
{"names": true, "holders": [{"pid": 1234, "app_id": "us.zoom.xos", "name": "zoom.us"}]}
```

Lines that are not such an object are skipped. `names` follows the last line, and before the first one comes from the macOS version. A helper that exits is started again after 5 s, and what it said last stays meanwhile; on stop it gets `stop` on stdin and is ended after 2 s. Without the helper `available` is false.

Nothing here goes to the network: the drivers ask the local sound server or CoreAudio.

---

## Source files

| File | Description |
|---|---|
| `app/services/mic_activity_service.py` | The service, `CallSignals`, the Linux driver and its parsers, `mic_driver()` |
| `app/services/mic_helper_driver.py` | `HelperMicDriver`: the holders as the capture helper reports them |
| `native/macos/sonorus-capture/main.swift` | `--watch-mic`, the CoreAudio side on macOS |
| `app/services/track_silence.py` | `SilenceWatch`, the silence of a live recording's tracks |
| `app/api/routers/audio_capture.py` | `GET /audio/mic-watch` |
| `electron/recording-prompts.js` | What the main process does with the events |
| `tests/test_mic_activity.py` | pactl output, the signals on a fake clock, the service on a fake driver, the route |
| `tests/test_mic_helper_driver.py` | Helper lines, the driver on a stand-in helper, the driver of macOS, the signals without names |
