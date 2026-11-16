---
sidebar_position: 13
---

# Live Recording Service

`app/services/live_recording_service.py` (`LiveRecordingService`) runs a live recording from start to the queue. Nothing of a recording lives in a window: a window starts it (`POST /audio/recording/start`), shows it from the queue snapshot and stops it (`POST /audio/recording/stop`), so the recording goes on when the window is closed, and a new window shows it as live and can stop it. The API is described in [API Endpoints → Live recording](../api/endpoints.md#live-recording).

One instance (`get_live_recording_service()` in `app/api/dependencies.py`) holds at most one recording. It drives [AudioCaptureService](./AudioCaptureService.md) for the tracks and [TranscriptionQueue](./TranscriptionQueue.md) for the pause and the job.

---

## Lifecycle

```
start(request)                         mic / mic_device, system / system_source, title, model, language
  → RecordingBusy if one is in progress; ValueError without a source
  → phase starting: queue.recording_started(state) — a running queue pauses, its job stops
  → start_capture(mic_device, kind="mic"), then start_capture(system_source)
      a track that cannot start: the other is discarded, the queue let go, the error raised
  → phase live, started_at = the earliest track start (Unix time, s): queue.recording_updated(state)
  → a watcher thread checks every 0.5 s that each capture process still runs

stop()                                 NotRecording unless live
  → phase stopping: queue.recording_updated(state); answers at once
  → on its own thread: capture.stop_recording(system_job, mic_job) → one file in recordings/
  → queue.add(file, title, model, language) — the recording joins the end of the queue
  → state cleared, then queue.recording_stopped(*events): the queue may run again only now

watcher: a capture process ended by itself (a microphone unplugged, a helper that failed)
  → the same stop, and a recording_source_lost event {source: "mic" | "system", title}

failure while stopping or queuing
  → a recording_failed event {title, error}; the temp files are gone, the queue is let go

shutdown()                             the backend goes down (app lifespan)
  → the captures are discarded; a recording still running is not saved
```

The phase, title, start time and sources are `recording` in the queue snapshot, and the events go out with the queue's over `WS /ws/queue`. The models a job needs are checked by the route before `start()`, so a recording that could not be queued does not start.

`is_recording()` is true from the start until the recording is queued or failed. `POST /data/reset`, deleting a speaker and a GPU restart wait for it: the recording writes a new file into `recordings/` and becomes a job.

---

## Source files

| File | Description |
|---|---|
| `app/services/live_recording_service.py` | The service |
| `app/api/routers/audio_capture.py` | `POST /audio/recording/start`, `POST /audio/recording/stop`, `GET /audio/capture/inputs` |
| `app/api/required_models.py` | The model check shared with `POST /queue/jobs` |
| `tests/test_live_recording.py` | The service on a fake capture (`tests/capture_fakes.py`) and a real queue |
