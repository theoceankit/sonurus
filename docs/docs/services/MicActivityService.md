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
| `call_ended {reason: "mic_released"}` | During a recording another app held a microphone, and now none has for 15 s. Once, until an app takes the microphone again. A recording during which no other app held a microphone (a meeting in the room) never ends this way. |

The other end of a call, `call_ended {reason: "silence"}`, comes from [LiveRecordingService](./LiveRecordingService.md): no track had sound for 5 minutes.

`GET /audio/mic-watch` says whether there is a signal on this system (`available`) and whether it names the app (`names`), for Settings → Notifications.

---

## Drivers

| OS | Driver | Notes |
|---|---|---|
| Linux | `LinuxMicDriver` | `pactl subscribe` says when a recording stream comes, goes or changes; `pactl -f json list source-outputs` (the text list for pactl older than 16) and `pactl list short sources` say who records what. Left out: streams of a monitor source (they record what plays), paused (corked) streams, level meters (`Peak detect` of pavucontrol, `stream.monitor`). The name is `application.name`, or the program (`application.process.binary`) when the name says how rather than who (`WEBRTC VoiceEngine` of Discord, `ZOOM VoiceEngine`); `app_id` is the program. A browser is one app for all its tabs. A sound server that restarts is followed after 5 s. Needs `pactl` (`pulseaudio-utils`, `libpulse` on Arch Linux), as recording does. |
| Windows, macOS | — | No driver yet: `available` is false and Settings marks the start of a call as not available. The end of a call by silence works. |

Nothing here goes to the network: the drivers ask the local sound server.

---

## Source files

| File | Description |
|---|---|
| `app/services/mic_activity_service.py` | The service, `CallSignals`, the Linux driver and its parsers |
| `app/services/track_silence.py` | `SilenceWatch`, the silence of a live recording's tracks |
| `app/api/routers/audio_capture.py` | `GET /audio/mic-watch` |
| `electron/recording-prompts.js` | What the main process does with the events |
| `tests/test_mic_activity.py` | pactl output, the signals on a fake clock, the service on a fake driver, the route |
