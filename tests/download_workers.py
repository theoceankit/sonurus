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


def gated_worker(kwargs, conn):
    """Reports what the real worker sends for a gated repo without a token."""
    conn.send(("error", "GatedRepoError", "401 Client Error. Cannot access gated repo", "no_token"))


def refusing_worker(kwargs, conn):
    """Reports what the real worker sends when the Hub's server refuses the download."""
    conn.send(("error", "HfHubHTTPError", "503 Server Error: Service Unavailable", "failed", True))


def refusing_without_xet_worker(kwargs, conn):
    """Refuses a plain download and lets one through Xet, by the switch it is given."""
    if kwargs.get("use_xet"):
        conn.send(("ok",))
    else:
        conn.send(("error", "HfHubHTTPError", "503 Server Error: Service Unavailable", "failed", True))
