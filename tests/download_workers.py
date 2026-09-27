"""Stand-ins for the snapshot_download worker, run in a spawned child process.

The child re-imports the module that defines the worker, so this module must
not import app code: in CI the ML libraries (huggingface_hub, torch, …) are
not installed, and the conftest stubs exist only in the parent process.
"""


def slow_worker(kwargs, conn):
    """Never finishes on its own."""
    import time
    time.sleep(60)


def failing_worker(kwargs, conn):
    conn.send(("error", "OSError", "boom"))


def crashing_worker(kwargs, conn):
    import os
    os._exit(3)  # dies without reporting, e.g. killed by the OOM killer
