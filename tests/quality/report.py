"""Report of a quality run: Markdown table, printed by pytest and saved next to the set."""
import math
import time
from pathlib import Path

ROWS: list[dict] = []   # one per variant, from harness.evaluate()
DEVICES: dict[str, str] = {}  # speaker → device in call.wav, from the manifest
NOTES: list[str] = []


def add(result: dict, variant) -> None:
    if not DEVICES:
        import json
        from pathlib import Path
        manifest = json.loads((Path(__file__).parent / "ami_manifest.json").read_text())
        DEVICES.update({s: d for s, d in manifest["devices"].items()})
        DEVICES[manifest["uneven_quiet_speaker"]] += ", −20 dB in uneven"
    ROWS.append({**result, "what": variant.what, "base": variant.base})


def note(text: str) -> None:
    NOTES.append(text)


def _pct(x: float) -> str:
    return "–" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.1f}%"


def markdown() -> str:
    lines = ["# Audio quality run", "", time.strftime("%Y-%m-%d %H:%M"), ""]
    lines += [f"- {n}" for n in NOTES] + [""]
    lines += ["| Variant | Compared with | WER | Speaker words | Missed utterances (3+ words) | Missed short | Recognised | Similarity (own / other) | What |",
              "|---|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        lines.append(
            f"| {r['variant']} | {r['base'] or '–'} | {_pct(r['wer'])} | {_pct(r['speaker_acc'])} "
            f"| {r['missed']} / {r['utterances']} | {r['missed_short']} / {r['short']} "
            f"| {r['recognised']} / {r['named_total']} "
            f"| {r['similarity']:.3f} / {r['other_similarity']:.3f} | {r['what']} |")
    speakers = sorted({s for r in ROWS for s in r["recall_by_speaker"]})
    if speakers:
        lines += ["", "## Words recognised per speaker", "",
                  "| Variant | " + " | ".join(f"{s} ({DEVICES.get(s, '')})" for s in speakers) + " |",
                  "|---|" + "---|" * len(speakers)]
        for r in ROWS:
            lines.append(f"| {r['variant']} | " + " | ".join(
                _pct(r["recall_by_speaker"].get(s)) for s in speakers) + " |")
    lines += ["", "## Per clip", "",
              "| Variant | Clip | Lang | WER | sub / del / ins | Speakers (hyp / ref) | Speaker words "
              "| Missed | Missed level, dBFS | Found level (median) | Recognised / wrong / new | Similarity | Lag, ms | Time, s |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in ROWS:
        for c in r["clips"]:
            rec = (f"{c['recognised']} / {c['wrong']} / {c['new']}" if "recognised" in c else "named")
            sim = f"{c['similarity']:.3f}" if "similarity" in c and not math.isnan(c["similarity"]) else "–"
            lines.append(
                f"| {r['variant']} | {c['clip']} | {c['language']} | {_pct(c['wer'])} "
                f"| {c['sub']} / {c['del']} / {c['ins']} | {c['hyp_speakers']} / {c['ref_speakers']} "
                f"| {_pct(c['speaker_acc'])} | {c['missed']} / {c['utterances']} "
                f"| {', '.join(map(str, c['missed_level'])) or '–'} | {c['found_level_median']:.1f} "
                f"| {rec} | {sim} | {1000 * c['lag']:.0f} | {c['seconds']:.0f} |")
    lines += ["", "## Missed utterances (3+ words)", ""]
    for r in ROWS:
        for c in r["clips"]:
            for text, lvl in zip(c["missed_text"], c["missed_level"]):
                lines.append(f"- {r['variant']} {c['clip']} ({lvl} dBFS): {text}")
    return "\n".join(lines) + "\n"


def write(text: str) -> Path:
    from tests.quality.harness import set_dir
    out = set_dir().parent / "reports"
    out.mkdir(parents=True, exist_ok=True)
    path = out / time.strftime("%Y-%m-%d-%H%M%S.md")
    path.write_text(text)
    return path
