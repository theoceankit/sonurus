"""Product version: the `version` field of package.json is the single source.

Electron passes it to the backend as SONORUS_VERSION (the packaged backend has no
package.json next to it); a backend started by hand from the repo reads package.json.
"""
import json
import os
from pathlib import Path

PACKAGE_JSON = Path(__file__).resolve().parents[1] / "package.json"
UNKNOWN = "unknown"


def get_version(env=None, package_json=PACKAGE_JSON) -> str:
    env = os.environ if env is None else env
    from_env = (env.get("SONORUS_VERSION") or "").strip()
    if from_env:
        return from_env
    try:
        version = json.loads(Path(package_json).read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        return UNKNOWN
    return version.strip() if isinstance(version, str) and version.strip() else UNKNOWN
