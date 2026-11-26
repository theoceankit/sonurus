"""No test may touch real data: the default database (DB_PATH, in the current
directory when no SONORUS_DATA_DIR is set) is never opened by a test."""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Starts the app as API tests do, patching nothing itself.
_LIFESPAN_TEST = '''
from fastapi.testclient import TestClient

from app.api.main import app


def test_lifespan():
    import app.api.main as main_module
    main_module.models.shutdown_executor = lambda: None
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
'''


def test_app_lifespan_in_tests_leaves_no_database_in_the_working_directory(tmp_path):
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    (tmp_path / "test_lifespan.py").write_text(_LIFESPAN_TEST)
    env = {k: v for k, v in os.environ.items() if k not in ("SONORUS_DATA_DIR", "DB_PATH")}
    env["PYTHONPATH"] = str(REPO)
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "tests.conftest", "-p", "no:cacheprovider",
         "--rootdir", str(tmp_path), str(tmp_path / "test_lifespan.py")],
        cwd=cwd, env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert list(cwd.iterdir()) == []
