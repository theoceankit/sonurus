"""Pure parts of the long quality set and of the threshold sweep
(scripts/eval/threshold_sweep.py, scripts/eval/build_ami_set.py,
tests/quality/harness.voices): no models, small synthetic voices."""
import importlib.util
import struct
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from tests.quality import harness

ROOT = Path(__file__).resolve().parents[1]


def _script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "eval" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sweep = _script("threshold_sweep")
build = _script("build_ami_set")


# ── build_ami_set ────────────────────────────────────────────────────────────

def _wav_header(data_size, extra=b""):
    fmt = struct.pack("<HHIIHH", 1, 1, 16000, 32000, 2, 16)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + extra + b"data" + struct.pack("<I", data_size)
    return b"RIFF" + struct.pack("<I", 4 + len(body) + data_size) + body


def test_data_chunk_gives_offset_and_size_of_the_pcm():
    header = _wav_header(320, extra=b"LIST" + struct.pack("<I", 4) + b"INFO")
    assert build.data_chunk(header) == (len(header), 320)
    assert build.data_offset(header) == len(header)


def test_long_clips_in_the_manifest_have_devices_for_everyone():
    import json
    manifest = json.loads((ROOT / "tests" / "quality" / "ami_manifest.json").read_text())
    ids = [c["id"] for c in manifest["long"]["clips"]]
    assert len(ids) == len(set(ids))
    assert not set(ids) & {c["id"] for c in manifest["clips"]}
    # every person of the long set has a device for call.wav
    assert {"FEE013", "MEE014", "MEO015", "FEE016", "FIE088", "FIO087", "FIO084", "FIO089"} <= set(manifest["devices"])


# ── harness.voices ───────────────────────────────────────────────────────────

def test_voices_keep_turns_and_which_turn_each_segment_carries():
    a, b = np.array([1.0, 0.0]), np.array([0.0, 1.0])
    turns = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 2.0, "embedding": a},
             {"speaker": "SPEAKER_01", "start": 2.0, "end": 5.0, "embedding": b}]
    transcript = SimpleNamespace(segments=[SimpleNamespace(embedding=b), SimpleNamespace(embedding=None),
                                           SimpleNamespace(embedding=a)])
    v = harness.voices(turns, transcript, {"SPEAKER_00": "FEE005", "SPEAKER_01": None})
    assert list(v["turn_ref"]) == ["FEE005", ""]
    assert list(v["segment_turn"]) == [1, -1, 0]
    assert v["turn_embedding"].shape == (2, 2)


def test_voices_of_a_clip_without_turns():
    v = harness.voices([], SimpleNamespace(segments=[]), {})
    assert v["turn_embedding"].shape == (0, 0)


# ── threshold_sweep ──────────────────────────────────────────────────────────

def test_average_methods():
    embs = np.array([[2.0, 0.0], [0.0, 1.0]])
    durs = np.array([1.0, 3.0])
    assert np.allclose(sweep.average(embs, durs, "mean"), [1.0, 0.5])
    assert np.allclose(sweep.average(embs, durs, "norm"), [0.5, 0.5])
    assert np.allclose(sweep.average(embs, durs, "norm+dur"), [0.25, 0.75])
    with pytest.raises(ValueError):
        sweep.average(embs, durs, "median")


def _clip(name, named, voices):
    """voices: [(raw, ref, embedding)], one turn and one segment each."""
    return sweep.Clip(
        name, named,
        np.array([r for r, _, _ in voices]), np.array([p or "" for _, p, _ in voices]),
        np.ones(len(voices)), np.array([e for _, _, e in voices], dtype=float),
        np.arange(len(voices)))


def _v(*xs):
    return np.array(xs, dtype=float)


ANN, BOB = _v(1, 0, 0), _v(0, 1, 0)


def test_replay_recognises_people_above_the_threshold():
    clips = [_clip("a", True, [("S0", "ANN", ANN), ("S1", "BOB", BOB)]),
             _clip("b", False, [("S0", "BOB", _v(0.1, 1, 0.3)), ("S1", "ANN", _v(1, 0, 0.9))])]
    # ANN's later voice is ~0.74 to her profile, BOB's ~0.95
    o = sweep.replay(clips, 0.8, "mean")
    assert (o.recognised, o.total, o.wrong) == (1, 2, 0)
    o = sweep.replay(clips, 0.7, "mean")
    assert (o.recognised, o.total, o.wrong) == (2, 2, 0)
    assert sorted(round(x, 2) for x in o.own) == [0.74, 0.95]


def test_replay_counts_false_matches_also_in_named_clips():
    # CAT, named in the second clip, sounds like ANN: a false match there.
    clips = [_clip("a", True, [("S0", "ANN", ANN)]),
             _clip("b", True, [("S0", "CAT", _v(1, 0.2, 0))])]
    o = sweep.replay(clips, 0.7, "mean")
    assert (o.wrong, o.total) == (1, 0)


def test_replay_guard_keeps_a_far_recording_out_of_the_profile():
    # BOB is named twice; the second recording is far from the first, so the
    # guard keeps it out and his profile stays where it was.
    clips = [_clip("a", True, [("S0", "BOB", BOB)]),
             _clip("b", True, [("S0", "BOB", _v(0, 0, 1))]),
             _clip("c", False, [("S0", "BOB", BOB)])]
    o = sweep.replay(clips, 0.7, "mean")
    assert o.recognised == 1 and o.own == [pytest.approx(1.0)]


def test_replay_named_twice_averages_the_recordings():
    clips = [_clip("a", True, [("S0", "BOB", BOB)]),
             _clip("b", True, [("S0", "BOB", _v(0, 1, 0.5))]),
             _clip("c", False, [("S0", "BOB", _v(0, 1, 0.25))])]
    o = sweep.replay(clips, 0.7, "norm")
    profile = sweep._unit(BOB + sweep._unit(_v(0, 1, 0.5)))
    assert o.own == [pytest.approx(float(np.dot(sweep._unit(_v(0, 1, 0.25)), profile)))]
