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
| Windows | `HelperMicDriver` | The capture helper runs as `sonorus-capture.exe --watch-mic` for as long as the backend does (below). A holder is the process of an active audio session on any active input device, the system sounds session left out; the helper opens no stream and needs no permission. The name is the exe's FileDescription ("Zoom Meetings", "Google Chrome"), or the exe name; `app_id` is the exe name in lower case without `.exe`. An app built on WebView2 (the new Teams) records in an `msedgewebview2.exe` child and is named after the app that started it. A browser is one app for all its tabs. Session, device and state notifications wake the helper at once; it also looks once a second. |
| macOS 14.2 and newer | `HelperMicDriver` | `sonorus-capture --watch-mic` reads CoreAudio: the process objects (`kAudioHardwarePropertyProcessObjectList`) that run input (`kAudioProcessPropertyIsRunningInput`), with listeners on both and a look every 2 s. `app_id` is the bundle id of the outermost `.app` on the process's path, so the audio helper of a browser counts as the browser, and `name` its display name; a process outside an app is named by its executable (by its pid if even that cannot be read). No permission is needed. |
| macOS before 14.2 | `HelperMicDriver` | The same mode can only see that some process runs an input device (`kAudioDevicePropertyDeviceIsRunningSomewhere`): one holder `{"app_id": "microphone", "name": null}`, `names` false. A call starts without the app's name; the `mic_released` end is off, the end by silence stays. A device that also plays (some headsets) counts while it plays. |

Nothing here goes to the network: the drivers ask the local sound server or the audio system of the OS.

### The capture helper

`HelperMicDriver` (`app/services/mic_helper_driver.py`) is the driver of an OS whose bundled `sonorus-capture` helper also watches the microphones (`AudioCaptureService.capture_bin`; without the helper `available` is false). The helper prints one JSON object per line, the first at start and then one whenever the holders change:

```json
{"names": true, "holders": [{"pid": 1234, "app_id": "zoom", "name": "Zoom"}]}
```

`app_id` is the program, `name` the name to show or `null`, `names` whether the helper can name apps at all (it becomes the `names` of `GET /audio/mic-watch`; on macOS it starts from the OS version, 14.2 or newer, until the first line). Lines that are not such an object (warnings) and holders without an `app_id` are skipped, and so is the helper's own process. The holders are the last line read; each line read calls the service's refresh. The helper stops on a `stop` line or EOF on stdin, as when it records, so it also ends with the backend. A helper that ends by itself is started again after 5 s, keeping the last holders until its first line; one that cannot start counts as no holders.

---

## Source files

| File | Description |
|---|---|
| `app/services/mic_activity_service.py` | The service, `CallSignals`, the Linux driver and its parsers, `mic_driver()` |
| `app/services/mic_helper_driver.py` | `HelperMicDriver`, the lines of `sonorus-capture --watch-mic` |
| `native/windows/sonorus-capture/main.cpp` | `--watch-mic` on Windows: audio sessions of the input devices |
| `native/macos/sonorus-capture/main.swift` | `--watch-mic` on macOS: CoreAudio processes or input devices |
| `app/services/track_silence.py` | `SilenceWatch`, the silence of a live recording's tracks |
| `app/api/routers/audio_capture.py` | `GET /audio/mic-watch` |
| `electron/recording-prompts.js` | What the main process does with the events |
| `tests/test_mic_activity.py` | pactl output, the signals on a fake clock, the service on a fake driver, the route |
| `tests/test_mic_helper_driver.py` | Helper lines, the watch on a stand-in helper script, the driver per OS, the signals without names |
