"""Product version reported by the backend: SONORUS_VERSION → package.json → "unknown"."""
import json
from pathlib import Path

from app.version import get_version

REPO_PACKAGE_JSON = Path(__file__).resolve().parents[1] / "package.json"


def _package_json(tmp_path, content):
    path = tmp_path / "package.json"
    path.write_text(content, encoding="utf-8")
    return path


def test_env_wins_over_package_json(tmp_path):
    pkg = _package_json(tmp_path, json.dumps({"version": "0.2.0"}))
    assert get_version(env={"SONORUS_VERSION": "9.9.9"}, package_json=pkg) == "9.9.9"


def test_package_json_without_env(tmp_path):
    pkg = _package_json(tmp_path, json.dumps({"name": "sonorus", "version": "1.2.3"}))
    assert get_version(env={}, package_json=pkg) == "1.2.3"


def test_empty_env_is_ignored(tmp_path):
    pkg = _package_json(tmp_path, json.dumps({"version": "1.2.3"}))
    assert get_version(env={"SONORUS_VERSION": "  "}, package_json=pkg) == "1.2.3"


def test_missing_package_json_is_unknown(tmp_path):
    assert get_version(env={}, package_json=tmp_path / "nope.json") == "unknown"


def test_broken_package_json_is_unknown(tmp_path):
    pkg = _package_json(tmp_path, "{not json")
    assert get_version(env={}, package_json=pkg) == "unknown"


def test_package_json_without_version_is_unknown(tmp_path):
    pkg = _package_json(tmp_path, json.dumps({"name": "sonorus"}))
    assert get_version(env={}, package_json=pkg) == "unknown"


def test_package_json_with_non_string_version_is_unknown(tmp_path):
    pkg = _package_json(tmp_path, json.dumps({"version": 2}))
    assert get_version(env={}, package_json=pkg) == "unknown"


def test_default_reads_repo_package_json(monkeypatch):
    monkeypatch.delenv("SONORUS_VERSION", raising=False)
    expected = json.loads(REPO_PACKAGE_JSON.read_text(encoding="utf-8"))["version"]
    assert get_version() == expected


def test_openapi_reports_product_version():
    from app.api.main import app

    expected = json.loads(REPO_PACKAGE_JSON.read_text(encoding="utf-8"))["version"]
    assert app.openapi()["info"]["version"] == expected
