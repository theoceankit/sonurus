"""Text Whisper invents over non-speech, on the padded set: speech in English
(AMI), Russian and Ukrainian (FLEURS) with silence, room noise, a ring tone or
music before it and, in the *-gaps variants, between it.

    .venv/bin/python scripts/eval/build_padded_set.py   # once
    SONORUS_QUALITY=1 .venv/bin/python -m pytest tests/quality/test_hallucinations.py -v -s

Every recording is decoded once with the no-speech check off; the chunks the
check would drop are taken out after, and both lists are aligned as the app
aligns (no diarization). A word inside an insert that matches no reference
word is invented; real speech that alignment stretched into an insert is not.
With the check, no dropped chunk may hold reference speech, and the invented
words left over the whole set stay within INVENTED_BUDGET; without it, they are
reported.

The budget is not zero: two "Thank you." on music have a no-speech probability
of 0.63, below what real speech reaches on the long set (0.71), and a few words
of chunks that mix speech with a ring tone or music stay with their speech.
"""
import json
from pathlib import Path

import pytest

from tests.quality import harness, report

MANIFEST = json.loads((Path(__file__).parent / "padded_manifest.json").read_text())
BASES = [b["id"] for b in MANIFEST["bases"]]
# The 15 s lead-ins are the first part of the 45 s ones and left out.
# Invented words the check leaves over the whole set (10 in November 2026, large-v3).
INVENTED_BUDGET = 10
VARIANTS = ["base", *(v["name"] for v in MANIFEST["variants"] if v["gaps"] or v["seconds"] == 45)]


@pytest.mark.parametrize("base", BASES)
def test_no_words_over_non_speech(pipeline, base):
    problems = []
    for variant in VARIANTS:
        folder = harness.padded_dir() / base
        if not (folder / f"{variant}.wav").exists():
            pytest.skip(f"padded set not built in {harness.padded_dir()}: run scripts/eval/build_padded_set.py")
        ref = json.loads((folder / f"{variant}.json").read_text())
        if any("start" not in i for i in ref["inserts"]):
            pytest.skip("padded set built before inserts had their times: run scripts/eval/build_padded_set.py")
        found = harness.hallucinations(pipeline, harness.load_wav(folder / f"{variant}.wav"), ref)
        if found is None:
            pytest.skip(f"alignment model for {ref['language']} not installed in {pipeline.transcription.models_dir}")
        report.HALLUCINATIONS.append({"base": base, "variant": variant, **found})
        if found["no_speech_dropped_speech"]:
            problems.append(f"{variant}: {found['no_speech_dropped_speech']} dropped chunks held speech")
    assert not problems, f"{base}: " + "; ".join(problems)


def test_invented_words_within_budget():
    """Runs after the bases (file order): every variant of every base must have run."""
    found = report.HALLUCINATIONS
    if len(found) < len(BASES) * len(VARIANTS):
        pytest.skip(f"{len(found)} of {len(BASES) * len(VARIANTS)} padded recordings ran")
    left = [f"{r['base']} {r['variant']}: {r['new']['invented_text']}" for r in found if r["new"]["invented"]]
    total = sum(r["new"]["invented"] for r in found)
    assert total <= INVENTED_BUDGET, (f"{total} invented words left in inserts, budget {INVENTED_BUDGET}: "
                                      + "; ".join(left))
