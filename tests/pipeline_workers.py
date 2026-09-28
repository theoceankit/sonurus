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


def run_and_report(report):
    """Middle process for the parent-death test: runs pid_worker through
    run_pipeline_process and reports the grandchild's pid, then blocks.
    Imports app.services.pipeline_process, which loads no ML libraries."""
    import threading
    from app.services.pipeline_process import run_pipeline_process
    run_pipeline_process({}, lambda step: report.put(int(step.split()[1])), threading.Event(),
                         worker=pid_worker)


def terminated_worker(args, conn):
    """Killed by SIGTERM from outside (session logout, system shutdown)."""
    import os
    import signal
    conn.send(("progress", "Transcribing audio…"))
    os.kill(os.getpid(), signal.SIGTERM)
