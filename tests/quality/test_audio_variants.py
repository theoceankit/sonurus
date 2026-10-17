"""How each way the audio reaches the models affects the transcript.

Every variant runs the AMI clips through the app's pipeline (see harness.py)
and is compared with the variant it derives from: a processing step must not
make the transcript, the speaker attribution or the recognition of named
speakers noticeably worse. Variants without a base (clean, call, uneven) only
report — they are listening conditions, not processing.
"""
import pytest

from tests.quality import harness, report

# Allowed degradation against the base variant (absolute).
WER_TOLERANCE = 0.02
SPEAKER_ACC_TOLERANCE = 0.05
RECOGNISED_TOLERANCE = 1  # named speakers recognised in the later clips

_results: dict[str, dict] = {}


def _result(pipeline, name, tmp_path_factory):
    if name not in _results:
        variant = harness.BY_NAME[name]
        if not (harness.set_dir() / harness.CLIPS[0] / variant.source).exists():
            pytest.skip(f"{variant.source} not built (scripts/eval/build_ami_set.py --chromium)")
        _results[name] = harness.evaluate(pipeline, variant, tmp_path_factory.mktemp(name))
        report.add(_results[name], variant)
    return _results[name]


@pytest.mark.parametrize("name", [v.name for v in harness.VARIANTS])
def test_variant(pipeline, tmp_path_factory, name):
    variant = harness.BY_NAME[name]
    if variant.base:
        _result(pipeline, variant.base, tmp_path_factory)
    result = _result(pipeline, name, tmp_path_factory)
    if not variant.base:
        return
    base = _results[variant.base]
    problems = []
    if result["wer"] > base["wer"] + WER_TOLERANCE:
        problems.append(f"WER {result['wer']:.3f} vs {base['wer']:.3f}")
    if result["speaker_acc"] < base["speaker_acc"] - SPEAKER_ACC_TOLERANCE:
        problems.append(f"speaker words {result['speaker_acc']:.3f} vs {base['speaker_acc']:.3f}")
    if result["recognised"] < base["recognised"] - RECOGNISED_TOLERANCE:
        problems.append(f"recognised {result['recognised']} vs {base['recognised']}")
    assert not problems, f"{name} is worse than {variant.base}: " + "; ".join(problems)
