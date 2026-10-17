"""Report of a quality run: Markdown printed by pytest and saved with the raw
results as JSON next to the set, in $SONORUS_EVAL_CACHE/reports/."""
import json
import math
import time
from pathlib import Path

ROWS: list[dict] = []   # one per variant, from harness.evaluate()
DEVICES: dict[str, str] = {}  # speaker → device in call.wav, from the manifest
NOTES: list[str] = []

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
- **Base**: the variant a processing step is compared with; the test fails when the variant is worse than its base \
by more than the tolerance. Variants without a base are listening conditions and only report.
- Every variant runs the same three 3-minute clips (es2002b, es2002c, es2002d) in this order on an empty speaker \
memory: the speakers of the first clip are named, the next two clips show whether they are recognised. The summary \
adds the three clips up; "Per clip" has one row per clip.
"""


def add(result: dict, variant) -> None:
    if not DEVICES:
        manifest = json.loads((Path(__file__).parent / "ami_manifest.json").read_text())
        DEVICES.update(manifest["devices"])
        DEVICES[manifest["uneven_quiet_speaker"]] += "; −20 dB in uneven"
    ROWS.append({**result, "what": variant.what, "base": variant.base})


def note(text: str) -> None:
    NOTES.append(text)


def _pct(x) -> str:
    return "–" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.1f}%"


def _num(x, digits=3) -> str:
    return "–" if x is None or math.isnan(x) else f"{x:.{digits}f}"


def markdown() -> str:
    lines = ["# Audio quality run", "", time.strftime("%Y-%m-%d %H:%M"), ""]
    lines += [f"- {n}" for n in NOTES] + ["", LEGEND, "## Summary per variant (three clips together)", "",
              "| Variant | Base | WER | Speaker words | Missed utterances (3+ words) | Missed short "
              "| Recognised | Similarity own / other | What |",
              "|---|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        lines.append(
            f"| {r['variant']} | {r['base'] or '–'} | {_pct(r['wer'])} | {_pct(r['speaker_acc'])} "
            f"| {r['missed']} / {r['utterances']} | {r['missed_short']} / {r['short']} "
            f"| {r['recognised']} / {r['named_total']} "
            f"| {_num(r['similarity'])} / {_num(r['other_similarity'])} | {r['what']} |")

    speakers = sorted({s for r in ROWS for s in r["recall_by_speaker"]})
    if speakers:
        lines += ["", "## Words recognised per speaker", "",
                  "Share of each person's words found in the transcript, three clips together. "
                  "In brackets: their device in call.", "",
                  "| Variant | " + " | ".join(f"{s} ({DEVICES.get(s, '')})" for s in speakers) + " |",
                  "|---|" + "---|" * len(speakers)]
        for r in ROWS:
            lines.append(f"| {r['variant']} | " + " | ".join(
                _pct(r["recall_by_speaker"].get(s)) for s in speakers) + " |")

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
            rec = f"{c['recognised']} / {c['wrong']} / {c['new']}" if "recognised" in c else "named here"
            lines.append(
                f"| {r['variant']} | {c['clip']} | {c['language']} | {_pct(c['wer'])} "
                f"| {c['sub']} / {c['del']} / {c['ins']} | {c['hyp_speakers']} / {c['ref_speakers']} "
                f"| {_pct(c['speaker_acc'])} | {c['missed']} / {c['utterances']} "
                f"| {', '.join(_num(v, 1) for v in c['missed_level']) or '–'} | {_num(c['found_level_median'], 1)} "
                f"| {rec} | {_num(c.get('similarity', math.nan))} | {1000 * c['lag']:.0f} | {c['seconds']:.0f} |")

    lines += ["", "## Missed utterances (3+ words)", "",
              "Reference text (normalised) and the audio level there.", ""]
    for r in ROWS:
        for c in r["clips"]:
            for text, lvl in zip(c["missed_text"], c["missed_level"]):
                lines.append(f"- {r['variant']}, {c['clip']} ({_num(lvl, 1)} dBFS): {text}")
    return "\n".join(lines) + "\n"


def write(text: str) -> Path:
    """Save the report and the raw results (JSON, for later comparison) side by side."""
    from tests.quality.harness import set_dir
    out = set_dir().parent / "reports"
    out.mkdir(parents=True, exist_ok=True)
    stem = time.strftime("%Y-%m-%d-%H%M%S")
    (out / f"{stem}.json").write_text(json.dumps({"notes": NOTES, "variants": ROWS}, indent=1, default=float))
    path = out / f"{stem}.md"
    path.write_text(text)
    return path
