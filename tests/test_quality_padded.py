"""Pure parts of the padded quality set (scripts/eval/build_padded_set.py):
inserts, placing them, shifting the reference, picking FLEURS utterances, the
manifest. No network, no models."""
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
SR = 16000


def _script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "eval" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _script("build_padded_set")
MANIFEST = json.loads((ROOT / "tests" / "quality" / "padded_manifest.json").read_text())


def _rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)))


# ── inserts ──────────────────────────────────────────────────────────────────

def test_silence_is_zero_of_the_given_length():
    x = build.silence(15)
    assert len(x) == 15 * SR and not x.any()


def test_room_noise_is_at_its_level_and_the_same_every_build():
    a = build.pink_noise(5, -50.0, seed=7)
    assert len(a) == 5 * SR
    assert _rms_db(a) == pytest.approx(-50.0, abs=0.2)
    assert np.array_equal(a, build.pink_noise(5, -50.0, seed=7))


def test_room_noise_is_pink_more_low_than_high():
    x = build.pink_noise(5, -50.0, seed=7)
    power = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    assert power[(f > 100) & (f < 200)].mean() > 10 * power[(f > 4000) & (f < 8000)].mean()


def test_ring_tone_sounds_one_second_in_five():
    x = build.ring_tone(15, hz=425, on=1.0, off=4.0, dbfs=-30.0)
    assert len(x) == 15 * SR
    loud = [bool(np.abs(x[int(t * SR):int((t + 0.5) * SR)]).max() > 0.01) for t in np.arange(0, 15, 0.5)]
    # on at 0–1, 5–6, 10–11 s; off in between
    assert loud == [t % 5 < 1 for t in np.arange(0, 15, 0.5)]
    assert _rms_db(x[int(0.1 * SR):int(0.9 * SR)]) == pytest.approx(-30.0, abs=0.3)
    spectrum = np.abs(np.fft.rfft(x[:SR]))
    assert np.fft.rfftfreq(SR, 1 / SR)[spectrum.argmax()] == pytest.approx(425, abs=2)


def test_music_insert_is_cut_from_the_track_at_speech_level():
    track = np.sin(np.arange(60 * SR) / 50.0) * 0.5
    x = build.make_insert("music", 15, {"dbfs": -30.0, "from_s": 10.0}, track)
    assert len(x) == 15 * SR
    assert _rms_db(x) == pytest.approx(-30.0, abs=0.3)
    with pytest.raises(RuntimeError):
        build.make_insert("music", 60, {"dbfs": -30.0, "from_s": 10.0}, track)


def test_inserts_fade_in_and_out():
    x = build.ring_tone(1, hz=425, on=1.0, off=4.0, dbfs=-30.0)
    assert abs(x[0]) < 1e-3 and abs(x[SR - 1]) < 1e-3


# ── placing and shifting ─────────────────────────────────────────────────────

def test_a_lead_in_pushes_every_word():
    words = [{"word": "a", "start": 0.5, "end": 0.9}, {"word": "b", "start": 10.0, "end": 10.4}]
    inserts = [{"at": 0.0, "insert": "music", "seconds": 45}]
    assert build.shift_reference(words, inserts) == [
        {"word": "a", "start": 45.5, "end": 45.9}, {"word": "b", "start": 55.0, "end": 55.4}]


def test_a_gap_pushes_only_what_comes_after_it():
    sentences = [{"text": "x", "start": 0.0, "end": 4.0}, {"text": "y", "start": 5.0, "end": 9.0}]
    inserts = [{"at": 0.0, "insert": "ring", "seconds": 15}, {"at": 4.5, "insert": "silence", "seconds": 20}]
    assert build.shift_reference(sentences, inserts) == [
        {"text": "x", "start": 15.0, "end": 19.0}, {"text": "y", "start": 40.0, "end": 44.0}]


def test_place_puts_inserts_at_their_seconds():
    base = np.arange(10 * SR, dtype=float)
    out = build.place(base, [(0.0, np.full(2 * SR, -1.0)), (4.0, np.full(SR, -2.0))])
    assert len(out) == 13 * SR
    assert (out[:2 * SR] == -1).all()
    assert out[2 * SR] == 0                     # base starts after the lead-in
    assert (out[6 * SR:7 * SR] == -2).all()     # base 4 s → 6 s, gap there
    assert out[7 * SR] == 4 * SR                # base resumes at its 4 s


def test_variant_inserts_lead_in_then_gaps_in_order():
    variant = {"name": "v", "insert": "music", "seconds": 15,
               "gaps": [{"at": 90, "insert": "room", "seconds": 30}, {"at": 40, "insert": "silence", "seconds": 20}]}
    assert build.variant_inserts(variant) == [
        {"at": 0.0, "insert": "music", "seconds": 15},
        {"at": 40.0, "insert": "silence", "seconds": 20},
        {"at": 90.0, "insert": "room", "seconds": 30}]


def test_build_variant_shifts_reference_and_keeps_language():
    base = np.zeros(20 * SR)
    ref = {"language": "ru", "sentences": [{"text": "x", "start": 1.0, "end": 3.0}]}
    variant = {"name": "silence15", "insert": "silence", "seconds": 15, "gaps": []}
    audio, out = build.build_variant(base, ref, variant, MANIFEST, music=None)
    assert len(audio) == 35 * SR
    assert out["language"] == "ru" and out["variant"] == "silence15"
    assert out["sentences"] == [{"text": "x", "start": 16.0, "end": 18.0}]


def _words(*spans):
    return [{"word": f"w{i}", "start": a, "end": b} for i, (a, b) in enumerate(spans)]


def test_pause_near_takes_the_middle_of_the_longest_pause_in_reach():
    words = _words((0.0, 50.0), (50.4, 58.0), (59.6, 70.0), (70.2, 80.0))  # pauses 0.4, 1.6, 0.2 s
    assert build.pause_near(words, 60.0, reach=15.0) == pytest.approx(58.8)


def test_pause_near_ignores_pauses_out_of_reach():
    words = _words((0.0, 10.0), (14.0, 55.0), (55.3, 80.0))  # the 4 s pause is 45 s away
    assert build.pause_near(words, 60.0, reach=15.0) == pytest.approx(55.15)


def test_pause_near_never_lands_inside_overlapping_speech():
    # Two people at once: the second word starts before the first ends; the only
    # real pause is after both.
    words = _words((40.0, 62.0), (55.0, 60.0), (63.0, 70.0))
    assert build.pause_near(words, 58.0, reach=15.0) == pytest.approx(62.5)


def test_pause_near_without_a_pause_in_reach_takes_the_nearest_one():
    # Dense overlapping speech for the first 100 s (as AMI es2002b): the gap
    # goes to the nearest pause further away.
    words = _words((0.0, 103.7), (104.3, 142.0), (143.0, 180.0))
    assert build.pause_near(words, 60.0, reach=15.0) == pytest.approx(104.0)


def test_pause_near_skips_pauses_already_taken():
    words = _words((0.0, 103.7), (104.3, 142.0), (143.0, 180.0))
    assert build.pause_near(words, 120.0, reach=15.0, taken=[104.0]) == pytest.approx(142.5)


def test_pause_near_ignores_pauses_shorter_than_a_tenth_of_a_second():
    words = _words((0.0, 59.95), (60.0, 100.0), (101.0, 120.0))
    assert build.pause_near(words, 60.0, reach=15.0) == pytest.approx(100.5)


def test_pause_near_without_any_pause_fails():
    with pytest.raises(RuntimeError):
        build.pause_near(_words((0.0, 200.0)), 60.0, reach=15.0)


def test_two_gaps_near_each_other_never_share_a_pause():
    variant = {"name": "v", "insert": "ring", "seconds": 45,
               "gaps": [{"near": 60, "insert": "ring", "seconds": 30}, {"near": 120, "insert": "ring", "seconds": 60}]}
    words = _words((0.0, 103.7), (104.3, 142.0), (143.0, 180.0))
    assert [i["at"] for i in build.variant_inserts(variant, words)] == [0.0, 104.0, 142.5]


def test_gaps_near_a_second_are_put_into_pauses_of_the_reference():
    variant = {"name": "ring-gaps", "insert": "ring", "seconds": 45,
               "gaps": [{"near": 60, "insert": "ring", "seconds": 30}, {"near": 120, "insert": "ring", "seconds": 60}]}
    words = _words((0.0, 59.0), (60.0, 119.5), (120.5, 180.0))
    assert build.variant_inserts(variant, words) == [
        {"at": 0.0, "insert": "ring", "seconds": 45},
        {"at": 59.5, "insert": "ring", "seconds": 30},
        {"at": 120.0, "insert": "ring", "seconds": 60}]


def test_a_gap_keeps_its_own_music_offset():
    variant = {"name": "music-gaps", "insert": "music", "seconds": 45,
               "gaps": [{"near": 60, "insert": "music", "seconds": 30, "from_s": 50}]}
    inserts = build.variant_inserts(variant, _words((0.0, 59.0), (60.0, 100.0)))
    assert inserts[1] == {"at": 59.5, "insert": "music", "seconds": 30, "from_s": 50}


def test_music_insert_from_a_later_second_of_the_track():
    music = np.concatenate([np.full(10 * SR, 0.1), np.linspace(-0.5, 0.5, 5 * SR), np.zeros(5 * SR)])
    spec = {**MANIFEST["inserts"]["music"], "from_s": 10.0}
    x = build.make_insert("music", 5, spec, music)
    assert len(x) == 5 * SR
    assert x[SR] < 0 < x[4 * SR]   # the ramp, not the flat start


def test_insert_spans_are_in_the_variant_timeline():
    inserts = [{"at": 0.0, "insert": "ring", "seconds": 45}, {"at": 59.5, "insert": "ring", "seconds": 30},
               {"at": 120.0, "insert": "ring", "seconds": 60}]
    assert build.insert_spans(inserts) == [(0.0, 45.0), (104.5, 134.5), (195.0, 255.0)]


def test_build_variant_with_gaps_never_cuts_a_word():
    base = np.zeros(180 * SR)
    words = _words((0.0, 59.0), (60.0, 119.5), (120.5, 179.0))
    ref = {"language": "en", "words": words}
    variant = {"name": "silence-gaps", "insert": "silence", "seconds": 45,
               "gaps": [{"near": 60, "insert": "silence", "seconds": 30},
                        {"near": 120, "insert": "silence", "seconds": 60}]}
    audio, out = build.build_variant(base, ref, variant, MANIFEST, music=None)
    assert len(audio) == (180 + 135) * SR
    spans = [(i["start"], i["end"]) for i in out["inserts"]]
    assert spans == [(0.0, 45.0), (104.5, 134.5), (195.0, 255.0)]
    for w in out["words"]:
        assert all(w["end"] <= a or w["start"] >= b for a, b in spans), w
    assert [(w["start"], w["end"]) for w in out["words"]] == [(45.0, 104.0), (135.0, 194.5), (255.5, 314.0)]


# ── FLEURS ───────────────────────────────────────────────────────────────────

def _rows():
    rows = []
    for sentence in range(1, 31):
        for k, gender in enumerate(("FEMALE", "MALE", "FEMALE")):
            rows.append({"sentence": sentence, "file": f"{sentence}-{k}.wav", "text": f"s{sentence}",
                         "samples": 10 * SR, "gender": gender})
    return rows


def test_pick_utterances_never_repeats_a_sentence_and_alternates_readers():
    picks = build.pick_utterances(_rows(), clips=3, seconds=50, pause=1.0)
    assert len(picks) == 3
    files = [f for clip in picks for f in clip]
    sentences = [f.split("-")[0] for f in files]
    assert len(set(sentences)) == len(sentences)
    rows = {r["file"]: r for r in _rows()}
    genders = [rows[f]["gender"] for f in picks[0]]
    assert genders[:4] == ["FEMALE", "MALE", "FEMALE", "MALE"]
    # 5 utterances of 10 s + 1 s pause reach 50 s
    assert [len(c) for c in picks] == [5, 5, 5]


def test_pick_utterances_fails_when_the_table_is_too_short():
    with pytest.raises(RuntimeError):
        build.pick_utterances(_rows(), clips=3, seconds=500, pause=1.0)


def test_pauses_stay_in_range_and_are_fixed():
    p = build.pauses(20, 0.6, 1.2)
    assert all(0.6 <= x <= 1.2 for x in p)
    assert len(set(p)) > 3
    assert p == build.pauses(20, 0.6, 1.2)


def test_speech_level_ignores_silence_around_the_utterance():
    tone = np.sin(np.arange(SR) * 0.3) * 0.1
    padded = np.concatenate([np.zeros(3 * SR), tone, np.zeros(3 * SR)])
    assert build.speech_level(padded) == pytest.approx(_rms_db(tone), abs=0.5)


def test_glue_levels_utterances_and_times_sentences():
    loud, quiet = np.full(SR, 0.5), np.full(2 * SR, 0.01)
    audio, sentences = build.glue([("a", loud), ("b", quiet)], gaps=[1.0], dbfs=-30.0)
    assert len(audio) == 4 * SR
    assert sentences == [{"text": "a", "start": 0.0, "end": 1.0}, {"text": "b", "start": 2.0, "end": 4.0}]
    assert _rms_db(audio[:SR]) == pytest.approx(-30.0, abs=0.1)
    assert _rms_db(audio[2 * SR:]) == pytest.approx(-30.0, abs=0.1)


# ── manifest ─────────────────────────────────────────────────────────────────

def test_manifest_variants_are_named_uniquely_and_use_known_inserts():
    names = [v["name"] for v in MANIFEST["variants"]]
    assert len(names) == len(set(names))
    for v in MANIFEST["variants"]:
        assert v["insert"] in MANIFEST["inserts"]
        assert all(g["insert"] in MANIFEST["inserts"] for g in v["gaps"])
    lead_ins = [v for v in MANIFEST["variants"] if not v["gaps"]]
    assert {(v["insert"], v["seconds"]) for v in lead_ins} == {
        (k, s) for k in ("silence", "room", "ring", "music") for s in (15, 45)}


def test_manifest_gap_variants_put_30_and_60_s_between_the_speech():
    gapped = {v["name"]: v for v in MANIFEST["variants"] if v["gaps"]}
    assert set(gapped) == {f"{k}-gaps" for k in ("silence", "room", "ring", "music")}
    for v in gapped.values():
        assert v["seconds"] == 45
        assert [(g["near"], g["seconds"], g["insert"]) for g in v["gaps"]] == [
            (60, 30, v["insert"]), (120, 60, v["insert"])]
    # the music never repeats a piece of the track: lead-in 0-45 s, then later parts
    pieces = sorted([(0, 45)] + [(g["from_s"], g["from_s"] + g["seconds"]) for g in gapped["music-gaps"]["gaps"]])
    assert all(a[1] <= b[0] for a, b in zip(pieces, pieces[1:]))
    assert pieces[-1][1] <= 189


def test_manifest_bases_cover_english_russian_and_ukrainian():
    langs = [b["language"] for b in MANIFEST["bases"]]
    assert (langs.count("en"), langs.count("ru"), langs.count("uk")) == (6, 3, 3)
    fleurs = MANIFEST["fleurs"]["languages"]
    for base in MANIFEST["bases"]:
        if base["source"] == "fleurs":
            clip = next(c for c in fleurs[base["language"]]["clips"] if c["id"] == base["id"])
            assert clip["files"], f"{base['id']}: no utterances recorded"


def test_manifest_pins_every_download():
    fleurs = MANIFEST["fleurs"]
    assert fleurs["revision"] in fleurs["tsv_url"] and fleurs["revision"] in fleurs["audio_url"]
    for entry in fleurs["languages"].values():
        assert len(entry["tsv_sha256"]) == 64 and len(entry["audio_sha256"]) == 64
    assert len(MANIFEST["music"]["sha256"]) == 64
    assert "CC BY" in MANIFEST["music"]["license"]
