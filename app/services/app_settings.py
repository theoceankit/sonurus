"""Settings the backend keeps for itself, in the app_settings table of the main
database: read once when made, then answered from memory, so a check on every
request costs nothing. Settings → Data → Reset clears them (clear())."""
import sqlite3
import threading

import app.config as config

# Whether /mcp answers agents (app/mcp/). Off on a new installation.
MCP_ENABLED = "mcp_enabled"
# Whether transcription jobs run on the GPU when PyTorch can use one
# (Settings → GPU acceleration). On on a new installation: whoever installs
# the GPU download wants it used.
USE_GPU = "use_gpu"

# A key not listed here is off by default.
DEFAULTS = {USE_GPU: True}


def job_device(settings: "AppSettings") -> str:
    """The device of the next transcription job: the GPU only if PyTorch can
    use one and the user has not turned it off."""
    return "cuda" if config.DEVICE == "cuda" and settings.get_bool(USE_GPU) else "cpu"


class AppSettings:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            self._values = dict(conn.execute("SELECT key, value FROM app_settings").fetchall())

    def _connect(self):
        return sqlite3.connect(self.db_path, timeout=30)

    def get_bool(self, key: str) -> bool:
        value = self._values.get(key)
        return DEFAULTS.get(key, False) if value is None else value == "1"

    def set_bool(self, key: str, value: bool) -> None:
        stored = "1" if value else "0"
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, stored),
                )
            self._values = {**self._values, key: stored}

    def clear(self) -> None:
        """Every setting back to its default, as on a new installation."""
        with self._lock:
            with self._connect() as conn:
                conn.execute("DELETE FROM app_settings")
            self._values = {}
