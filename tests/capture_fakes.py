"""A stand-in for AudioCaptureService in recording tests: tracks capture jobs
without processes or ffmpeg. No app imports."""


class FakeCapture:
    """Tracks capture jobs like AudioCaptureService, without processes."""

    def __init__(self, tmp_path):
        self.tmp = tmp_path
        self.jobs: dict[str, dict] = {}
        self.fail_start: dict[str, Exception] = {}
        self.fail_stop: Exception | None = None
        self.stopped: list[tuple] = []
        self.discarded: list[str] = []
        self.clock = 1000.0

    def start_capture(self, source_id=None, kind="system"):
        if kind in self.fail_start:
            raise self.fail_start[kind]
        job_id = f"{kind}-{len(self.jobs) + 1}"
        self.clock += 0.1
        self.jobs[job_id] = {"kind": kind, "source": source_id, "alive": True, "started_at": self.clock}
        return job_id

    def started_at(self, job_id):
        return self.jobs[job_id]["started_at"]

    def track_path(self, job_id):
        """Where a track is written; a test may write a WAV there."""
        return str(self.tmp / f"track-{job_id}.wav")

    def capture_pids(self):
        return set()

    def alive(self, job_id):
        return job_id in self.jobs and self.jobs[job_id]["alive"]

    def lose(self, kind):
        for job in self.jobs.values():
            if job["kind"] == kind:
                job["alive"] = False

    def stop_recording(self, system_job=None, mic_job=None):
        self.stopped.append((system_job, mic_job))
        for job_id in (system_job, mic_job):
            self.jobs.pop(job_id, None)
        if self.fail_stop:
            raise self.fail_stop
        self.tmp.mkdir(parents=True, exist_ok=True)
        path = self.tmp / f"sonorus-rec-{system_job or mic_job}.wav"
        path.write_bytes(b"RIFF")
        return str(path)

    def discard(self, job_id):
        self.discarded.append(job_id)
        self.jobs.pop(job_id, None)

    def discard_all(self):
        for job_id in list(self.jobs):
            self.discard(job_id)

    def has_active_jobs(self):
        return bool(self.jobs)

    def get_inputs(self):
        return [{"id": "alsa_input.maono", "label": "Maono"}]

    def get_sources(self):
        return [{"id": "@DEFAULT_MONITOR@", "label": "System audio (default)"}]
