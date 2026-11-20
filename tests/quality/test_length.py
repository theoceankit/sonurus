"""How recognition of named speakers depends on the length of the recordings
and on who else is in memory (the long set, run on request).

    .venv/bin/python scripts/eval/build_ami_set.py --long   # once, ~1 GB download, ~3 GB on disk
    SONORUS_QUALITY_LONG=1 .venv/bin/python -m pytest tests/quality/test_length.py -v -s

Every series runs its clips in order on one fresh speaker memory (see
harness.py): the named clips' speakers are named, the others recognised.
Only clean and call are run: the processing variants of the fast set are
compared there. The voices of every clip are saved next to the report
(.npz), for scripts/eval/threshold_sweep.py.
"""
from dataclasses import dataclass

import pytest

from tests.quality import harness, report


@dataclass(frozen=True)
class Series:
    name: str
    clips: tuple[str, ...]
    named: tuple[str, ...]
    what: str = ""


def _three_groups() -> tuple[str, ...]:
    # The meetings of three groups interleaved: each group's b is named
    # while the others' people are already in memory.
    return tuple(f"{group}{m}-10m" for m in "bcd" for group in ("es2002", "es2004", "is1009"))


SERIES = [
    Series("3 min", ("es2002b", "es2002c", "es2002d"), ("es2002b",), "the fast set's clips"),
    Series("10 min", ("es2002b-10m", "es2002c-10m", "es2002d-10m"), ("es2002b-10m",)),
    Series("whole", ("es2002b-full", "es2002c-full", "es2002d-full"), ("es2002b-full",), "36–40 min each"),
    Series("10 min, named in two", ("es2002a-10m", "es2002b-10m", "es2002c-10m", "es2002d-10m"),
           ("es2002a-10m", "es2002b-10m"), "profile from two recordings"),
    Series("three groups", _three_groups(), ("es2002b-10m", "es2004b-10m", "is1009b-10m"),
           "ES2002, ES2004 and IS1009 in one memory"),
]
BY_NAME = {s.name: s for s in SERIES}
VARIANTS = ("clean", "call")


@pytest.mark.parametrize("variant", VARIANTS)
@pytest.mark.parametrize("series", [s.name for s in SERIES])
def test_series(pipeline, tmp_path_factory, series, variant):
    s, v = BY_NAME[series], harness.BY_NAME[variant]
    missing = [c for c in s.clips if not (harness.set_dir() / c / v.source).exists()]
    if missing:
        pytest.skip(f"{', '.join(missing)} not built (scripts/eval/build_ami_set.py --long)")
    result = harness.evaluate(pipeline, v, tmp_path_factory.mktemp(f"{series}-{variant}".replace(" ", "_")),
                              clips=s.clips, named=frozenset(s.named))
    report.add(result, v, series=s.name)
    assert result["no_speech_dropped_speech"] == 0, (
        f"the no-speech check dropped {result['no_speech_dropped_speech']} chunks with speech")
    if s.name == "three groups":
        assert result["wrong"] == 0, f"{result['wrong']} false matches between people of different groups"
