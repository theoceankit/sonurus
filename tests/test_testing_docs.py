"""The coverage table in docs/docs/testing/overview.md lists every test file exactly once."""
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = ROOT / "tests"
OVERVIEW = ROOT / "docs" / "docs" / "testing" / "overview.md"

ROW_FILE = re.compile(r"^\|\s*`([^`]+)`\s*\|")


def _coverage_section():
    text = OVERVIEW.read_text(encoding="utf-8")
    start = text.index("## Current coverage")
    end = text.find("\n## ", start + 1)
    return text[start:] if end == -1 else text[start:end]


def _table_rows():
    return [line for line in _coverage_section().splitlines() if line.startswith("|")]


def _listed_files():
    return [m.group(1) for line in _table_rows() if (m := ROW_FILE.match(line))]


def _test_files_on_disk():
    python = {p.name for p in TESTS_DIR.glob("test_*.py")}
    renderer = {f"tests/renderer/{p.name}" for p in (TESTS_DIR / "renderer").glob("*.test.js")}
    return python | renderer


def test_every_test_file_has_a_row():
    missing = sorted(_test_files_on_disk() - set(_listed_files()))
    assert not missing, f"add a row to 'Current coverage' in {OVERVIEW.relative_to(ROOT)} for: {missing}"


def test_no_row_for_a_missing_file():
    extra = sorted(set(_listed_files()) - _test_files_on_disk())
    assert not extra, f"rows in 'Current coverage' name files that do not exist: {extra}"


def test_no_duplicate_rows():
    duplicates = sorted(name for name, n in Counter(_listed_files()).items() if n > 1)
    assert not duplicates, f"files listed more than once in 'Current coverage': {duplicates}"


def test_table_has_no_test_counts():
    header = _table_rows()[0]
    assert [c.strip() for c in header.strip("|").split("|")] == ["File", "What it covers"]
