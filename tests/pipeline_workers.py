"""Stand-ins for the transcription pipeline worker, run in a spawned child process.

The child re-imports the module that defines the worker, so this module must
not import app code: in CI the ML libraries (torch, whisperx, …) are not
installed, and the conftest stubs exist only in the parent process.

Messages follow the protocol of app.services.pipeline_process.
"""


def ok_worker(args, conn):
    conn.send(("progress", "Transcribing audio…"))
    conn.send(("progress", "Identifying speakers…"))
    conn.send(("done", {"audio_path": args["audio_path"], "segments": [1, 2, 3]}))


def slow_worker(args, conn):
    """Reports one step, then never finishes on its own."""
    import time
    conn.send(("progress", "Transcribing audio…"))
    time.sleep(60)


def pid_worker(args, conn):
    """Reports its pid, then never finishes on its own."""
    import os
    import time
    conn.send(("progress", f"pid {os.getpid()}"))
    time.sleep(60)


def failing_worker(args, conn):
    conn.send(("error", "OutOfMemoryError", "CUDA out of memory"))


def alignment_missing_worker(args, conn):
    conn.send(("alignment_missing", "de"))


def crashing_worker(args, conn):
    import os
    conn.send(("progress", "Transcribing audio…"))
    os._exit(3)  # dies without reporting, e.g. killed by the OOM killer
