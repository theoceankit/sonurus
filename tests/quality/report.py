"""Report of a quality run: Markdown printed by pytest and saved with the raw
results as JSON next to the set, in $SONORUS_EVAL_CACHE/reports/, and the
voices of every clip as .npz (scripts/eval/threshold_sweep.py reads them)."""
import json
import math
import time
from pathlib import Path

ROWS: list[dict] = []   # one per variant, from harness.evaluate()
DEVICES: dict[str, str] = {}  # speaker → device in call.wav, from the manifest
NOTES: list[str] = []
LANGUAGE: list[dict] = []  # one per padded-set recording, from test_language.py
HALLUCINATIONS: list[dict] = []  # one per padded-set recording, from test_hallucinations.py

LEGEND = """\
How to read it:

- **WER**: word error rate against the AMI manual transcript (substitutions + deletions + insertions), lower is \
better. Both sides are normalised first: lowercase, no punctuation, numbers as words, no "um / uh / mm".
- **Speaker words**: share of the matched words attributed to the right person.
- **Missed utterances**: reference utterances of which less than half of the words were recognised; utterances of \
3+ words and short ones (1–2 words, mostly "yeah", "okay" over someone else's speech) are counted apart.
- **Recognised**: in clips 2 and 3, how many of the people named in clip 1 the memory matched correctly, out of how many.
- **Similarity own / other**: cosine similarity of a person's voice in a later clip to their own profile from \
clip 1, and the highest one to another person's profile. A speaker is matched when it reaches \
SPEAKER_SIMILARITY_THRESHOLD.
- **Segments**: unassigned transcript segments (no speaker, count and seconds); mixed segments, whose words \
matched to the reference belong to 2+ people, out of all, and the words of anyone but the segment's main person \
in them; short utterances (1–2 words) with a word recognised, how many are under the right person; and, in what \
the pipeline returned before the transcript was built, segments without timed words, with empty text and longer \
than 15 s.
- **No speech dropped**: chunks the no-speech check took out before alignment, out of all decoded; in brackets \
those that overlapped reference speech (must be 0), and the highest no-speech probability of a chunk with speech.
- **Base**: the variant a processing step is compared with; the test fails when the variant is worse than its base \
by more than the tolerance. Variants without a base are listening conditions and only report.
- Every variant runs the same three 3-minute clips (es2002b, es2002c, es2002d) in this order on an empty speaker \
memory: the speakers of the first clip are named, the next two clips show whether they are recognised. The summary \
adds the three clips up; "Per clip" has one row per clip.
"""


def add(result: dict, variant, series: str | None = None) -> None:
    if not DEVICES:
        manifest = json.loads((Path(__file__).parent / "ami_manifest.json").read_text())
        DEVICES.update(manifest["devices"])
        DEVICES[manifest["uneven_quiet_speaker"]] += "; −20 dB in uneven"
    ROWS.append({**result, "what": variant.what, "base": variant.base, "series": series})


def _name(r) -> str:
    return f"{r['series']}: {r['variant']}" if r.get("series") else r["variant"]


def note(text: str) -> None:
    NOTES.append(text)


def _pct(x) -> str:
    return "–" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.1f}%"


def _share(part, whole):
    return part / whole if whole else None


def _num(x, digits=3) -> str:
    return "–" if x is None or math.isnan(x) else f"{x:.{digits}f}"


def _no_speech(r) -> str:
    if "no_speech_chunks" not in r:
        return "–"
    return (f"{r['no_speech_dropped']} / {r['no_speech_chunks']} ({r['no_speech_dropped_speech']}), "
            f"{_num(r['no_speech_max_speech'], 2)}")


def hallucinations_markdown() -> list[str]:
    """Words in the inserts of the padded set without the no-speech check (old)
    and with it (new)."""
    if not HALLUCINATIONS:
        return []
    lines = ["", "## Hallucinations", "",
             "Each recording of the padded set, transcribed and aligned without diarization: invented words "
             "(middle inside an insert, more than 0.5 s from its edges, matching no reference word), all words "
             "inside inserts (also real speech alignment stretched into them) and WER against the reference, "
             "without the no-speech check (old) and with it (new). Dropped: chunks the check took out, out of all decoded, in "
             "brackets those with reference speech (must be 0). Highest p of speech / lowest p of non-speech: the "
             "no-speech probabilities either side of the threshold.", "",
             "| Variant | Recordings | Invented, old | New | All words in inserts, old / new | WER old | WER new "
             "| Dropped (with speech) | Highest p of speech | Lowest p of non-speech |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    groups: dict[str, list[dict]] = {}
    for r in HALLUCINATIONS:
        groups.setdefault(r["variant"], []).append(r)

    def wer(rows, way):
        ref = sum(r[way]["ref_words"] for r in rows)
        return sum(r[way]["errors"] for r in rows) / ref if ref else None

    def nanmax(xs):
        xs = [x for x in xs if not math.isnan(x)]
        return max(xs) if xs else None

    def nanmin(xs):
        xs = [x for x in xs if not math.isnan(x)]
        return min(xs) if xs else None

    for variant, rows in groups.items():
        lines.append(
            f"| {variant} | {len(rows)} | {sum(r['old']['invented'] for r in rows)} "
            f"| {sum(r['new']['invented'] for r in rows)} "
            f"| {sum(r['old']['inserted'] for r in rows)} / {sum(r['new']['inserted'] for r in rows)} "
            f"| {_pct(wer(rows, 'old'))} | {_pct(wer(rows, 'new'))} "
            f"| {sum(r['no_speech_dropped'] for r in rows)} / {sum(r['no_speech_chunks'] for r in rows)} "
            f"({sum(r['no_speech_dropped_speech'] for r in rows)}) "
            f"| {_num(nanmax([r['no_speech_max_speech'] for r in rows]), 2)} "
            f"| {_num(nanmin([r['no_speech_min_other'] for r in rows]), 2)} |")
    lines += ["", "| Recording | Variant | Lang | Invented, old | New | WER old / new | Dropped "
              "| Highest p of speech | Lowest p of non-speech | Invented text, old |",
              "|---|---|---|---|---|---|---|---|---|---|"]
    for r in HALLUCINATIONS:
        lines.append(
            f"| {r['base']} | {r['variant']} | {r['language']} | {r['old']['invented']} | {r['new']['invented']} "
            f"| {_pct(r['old']['wer'])} / {_pct(r['new']['wer'])} | {r['no_speech_dropped']} / "
            f"{r['no_speech_chunks']} ({r['no_speech_dropped_speech']}) | {_num(r['no_speech_max_speech'], 2)} "
            f"| {_num(r['no_speech_min_other'], 2)} | {r['old']['invented_text'][:120] or '–'} |")
    return lines


def language_markdown() -> list[str]:
    """Language detection on the padded set: the old way (WhisperX, the first
    30 s of the file) against the app's (from the speech VAD found)."""
    if not LANGUAGE:
        return []
    lines = ["", "## Language detection", "",
             "Each recording of the padded set: the expected language, the one WhisperX's own detection takes "
             "from the first 30 s of the file (old), and the one the app takes from the speech VAD found (new), "
             "with its probability, seconds of speech and windows used. Lead-in: what was put before the speech "
             "and for how long.", "",
             "| Lead-in | Recordings | Old right | New right | New probability, lowest | More windows |",
             "|---|---|---|---|---|---|"]
    groups: dict[str, list[dict]] = {}
    for r in LANGUAGE:
        groups.setdefault(r["variant"], []).append(r)
    for variant, rows in groups.items():
        probs = [r["new_p"] for r in rows if r["new_p"] is not None]
        lines.append(
            f"| {variant} | {len(rows)} | {sum(r['old'] == r['expected'] for r in rows)} "
            f"| {sum(r['new'] == r['expected'] for r in rows)} | {_num(min(probs) if probs else None, 2)} "
            f"| {sum(r['windows'] > 1 for r in rows)} |")
    lines += ["", "| Recording | Lead-in | Expected | Old (p) | New (p) | Speech, s | Windows | Speech from, s |",
              "|---|---|---|---|---|---|---|---|"]
    for r in LANGUAGE:
        mark = "" if r["new"] == r["expected"] else " ✗"
        old_mark = "" if r["old"] == r["expected"] else " ✗"
        lines.append(
            f"| {r['base']} | {r['variant']} | {r['expected']} | {r['old']} ({_num(r['old_p'], 2)}){old_mark} "
            f"| {r['new']} ({_num(r['new_p'], 2)}){mark} | {r['speech_s']:.0f} | {r['windows']} "
            f"| {_num(r['speech_start'], 1)} |")
    return lines


def markdown() -> str:
    lines = ["# Audio quality run", "", time.strftime("%Y-%m-%d %H:%M"), ""]
    lines += [f"- {n}" for n in NOTES]
    if not ROWS:
        return "\n".join(lines + language_markdown() + hallucinations_markdown()) + "\n"
    lines += ["", LEGEND, "## Summary per variant (three clips together)", "",
              "| Variant | Base | WER | Speaker words | Missed utterances (3+ words) | Missed short "
              "| Recognised | Similarity own / other | No speech dropped (with speech), highest p of speech | What |",
              "|---|---|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        lines.append(
            f"| {_name(r)} | {r['base'] or '–'} | {_pct(r['wer'])} | {_pct(r['speaker_acc'])} "
            f"| {r['missed']} / {r['utterances']} | {r['missed_short']} / {r['short']} "
            f"| {r['recognised']} / {r['named_total']} "
            f"| {_num(r['similarity'])} / {_num(r['other_similarity'])} "
            f"| {_no_speech(r)} | {r['what']} |")

    speakers = sorted({s for r in ROWS for s in r["recall_by_speaker"]})
    if speakers:
        lines += ["", "## Words recognised per speaker", "",
                  "Share of each person's words found in the transcript, three clips together. "
                  "In brackets: their device in call.", "",
                  "| Variant | " + " | ".join(f"{s} ({DEVICES.get(s, '')})" for s in speakers) + " |",
                  "|---|" + "---|" * len(speakers)]
        for r in ROWS:
            lines.append(f"| {_name(r)} | " + " | ".join(
                _pct(r["recall_by_speaker"].get(s)) for s in speakers) + " |")

    if any(r.get("series") for r in ROWS):
        lines += ["", "## Similarity by series", "",
                  "Recognition over the clips that are not named; wrong also counts false matches in named clips "
                  "(people of earlier clips already in memory). Own: each person's voice against their own "
                  "profile, mean and lowest; other: the highest against anyone else's profile, mean and highest.",
                  "", "| Series | Variant | Recognised | Wrong | Own mean / min | Other mean / max |",
                  "|---|---|---|---|---|---|"]
        for r in ROWS:
            lines.append(
                f"| {r['series']} | {r['variant']} | {r['recognised']} / {r['named_total']} | {r['wrong']} "
                f"| {_num(r['similarity'])} / {_num(r['own_min'])} "
                f"| {_num(r['other_similarity'])} / {_num(r['other_max'])} |")

    lines += ["", "## Segments", "",
              "Summary per variant, then one row per clip. Mixed: segments / all (words of other people in them). "
              "Short right: right / recognised 1–2-word utterances. No words, empty, over 15 s: out of the "
              "pipeline's segments before the transcript was built.", "",
              "| Variant | Clip | Unassigned (s) | Mixed / all (other words) | Short right "
              "| No words | Empty | Over 15 s / all |",
              "|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        for c in [{**r, "clip": "all"}, *r["clips"]]:
            lines.append(
                f"| {_name(r)} | {c['clip']} | {c['unassigned']} ({c['unassigned_s']:.1f}) "
                f"| {c['mixed']} / {c['segments']} ({c['mixed_minority_words']}) "
                f"| {c['short_right']} / {c['short_found']} ({_pct(_share(c['short_right'], c['short_found']))}) "
                f"| {c['no_words']} | {c['empty_text']} | {c['long_segments']} / {c['raw_segments']} |")

    lines += ["", "## Per clip", "",
              "Three rows per variant, one per clip. In the first clip the speakers are named (no recognition "
              "yet); the next two are matched against them. WER errors: substitutions / deletions / insertions. "
              "Lag: how far a Chromium recording is shifted against its source (taken into account).", "",
              "| Variant | Clip | Lang | WER | Sub / del / ins | Speakers (found / reference) | Speaker words "
              "| Missed (3+ words) | Missed level, dBFS | Other utterances level (median) "
              "| Recognised / wrong / new | Similarity | Lag, ms | Time, s |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        for c in r["clips"]:
            rec = f"{c['recognised']} / {c['wrong']} / {c['new']}" if "recognised" in c else "–"
            if c.get("named_here"):
                rec += " (named here)" if "recognised" in c else "named here"
            lines.append(
                f"| {_name(r)} | {c['clip']} | {c['language']} | {_pct(c['wer'])} "
                f"| {c['sub']} / {c['del']} / {c['ins']} | {c['hyp_speakers']} / {c['ref_speakers']} "
                f"| {_pct(c['speaker_acc'])} | {c['missed']} / {c['utterances']} "
                f"| {', '.join(_num(v, 1) for v in c['missed_level']) or '–'} | {_num(c['found_level_median'], 1)} "
                f"| {rec} | {_num(c.get('similarity', math.nan))} | {1000 * c['lag']:.0f} | {c['seconds']:.0f} |")

    lines += ["", "## Missed utterances (3+ words)", "",
              "Reference text (normalised) and the audio level there.", ""]
    for r in ROWS:
        for c in r["clips"]:
            for text, lvl in zip(c["missed_text"], c["missed_level"]):
                lines.append(f"- {_name(r)}, {c['clip']} ({_num(lvl, 1)} dBFS): {text}")
    return "\n".join(lines + language_markdown() + hallucinations_markdown()) + "\n"


def voices_key(series: str | None, variant: str, clip: str, field: str) -> str:
    """Name of one array in the .npz: <series>|<variant>|<clip>|<field>."""
    return f"{series or ''}|{variant}|{clip}|{field}"


def write(text: str) -> Path:
    """Save the report and the raw results (JSON, for later comparison) side by side."""
    from tests.quality.harness import set_dir
    out = set_dir().parent / "reports"
    out.mkdir(parents=True, exist_ok=True)
    stem = time.strftime("%Y-%m-%d-%H%M%S")
    arrays, rows = {}, []
    for r in ROWS:
        clips = []
        for c in r["clips"]:
            for field, a in c.get("_voices", {}).items():
                arrays[voices_key(r.get("series"), r["variant"], c["clip"], field)] = a
            clips.append({k: v for k, v in c.items() if not k.startswith("_")})
        rows.append({**r, "clips": clips})
    (out / f"{stem}.json").write_text(json.dumps({"notes": NOTES, "variants": rows, "language": LANGUAGE,
                                                 "hallucinations": HALLUCINATIONS},
                                                indent=1, default=float))
    if arrays:
        import numpy as np
        np.savez_compressed(out / f"{stem}.npz", **arrays)
    path = out / f"{stem}.md"
    path.write_text(text)
    return path
