"""Language detection on the padded set: speech in English (AMI), Russian and
Ukrainian (FLEURS) with silence, room noise, a ring tone or music before it.

    .venv/bin/python scripts/eval/build_ami_set.py      # once
    .venv/bin/python scripts/eval/build_padded_set.py   # once, ~350 MB download
    SONORUS_QUALITY=1 .venv/bin/python -m pytest tests/quality/test_language.py -v -s

Every recording is detected the old way (WhisperX's own: the first 30 s of the
file) and the app's way (from the speech the VAD pass found); only the
app's way must be right everywhere, the old one is reported. Only VAD and
Whisper's encoder run, no decoding, alignment or diarization.
"""
import json
from pathlib import Path

import pytest

from tests.quality import harness, report

MANIFEST = json.loads((Path(__file__).parent / "padded_manifest.json").read_text())
BASES = [b["id"] for b in MANIFEST["bases"]]
# Lead-ins only: the variants with inserts between the speech are for test_hallucinations.py.
VARIANTS = ["base", *(v["name"] for v in MANIFEST["variants"] if not v["gaps"])]


def _recording(base: str, variant: str):
    folder = harness.padded_dir() / base
    if not (folder / f"{variant}.wav").exists():
        pytest.skip(f"padded set not built in {harness.padded_dir()}: run scripts/eval/build_padded_set.py")
    ref = json.loads((folder / f"{variant}.json").read_text())
    return harness.load_wav(folder / f"{variant}.wav"), ref


@pytest.mark.parametrize("base", BASES)
def test_language_from_speech(pipeline, base):
    wrong = []
    for variant in VARIANTS:
        audio, ref = _recording(base, variant)
        found = harness.detect_language(pipeline, audio)
        lead = ref["inserts"][0] if ref["inserts"] and ref["inserts"][0]["at"] == 0 else None
        report.LANGUAGE.append({"base": base, "variant": variant, "expected": ref["language"],
                                "insert": lead["insert"] if lead else None,
                                "insert_s": lead["seconds"] if lead else 0, **found})
        assert found["windows"] >= 1, f"{base} {variant}: the detection did not get the VAD's speech"
        if found["new"] != ref["language"]:
            wrong.append(f"{variant}: {found['new']} ({found['new_p']:.2f})")
    assert not wrong, f"{base} is {ref['language']}, detected otherwise in " + "; ".join(wrong)


def test_transcribe_uses_the_speech(pipeline):
    """The hook works inside FasterWhisperPipeline.transcribe() itself: VAD,
    merge_chunks, then detect_language, in that order. A WhisperX update that
    changes it fails here, not silently. Room noise, not music: VAD takes
    parts of the music for speech, but never the noise."""
    audio, ref = _recording("ru1", "room45")
    hook = pipeline.transcription.language
    result = pipeline.transcription.model.transcribe(audio[: 90 * 16000], batch_size=2)
    assert hook.last is not None, "detect_language ran without the VAD's speech"
    assert hook.last.start >= 44.0, f"speech taken from {hook.last.start} s, inside the noise"
    assert result["language"] == ref["language"]
