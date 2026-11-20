#!/usr/bin/env python3
"""Build the padded quality set: speech with silence, noise, a ring tone or music
inserted before it (and, for variants that list gaps, between its sentences).

Bases (tests/quality/padded_manifest.json, "bases"):

  AMI       the fast set's clean.wav and call.wav (English; build_ami_set.py first)
  FLEURS    Russian and Ukrainian read speech (CC BY 4.0): the dev split's
            utterances listed in the manifest, glued into ~3-minute clips with
            short pauses, each utterance at -30 dBFS speech level as AMI

Inserts ("inserts"): digital silence, pink room noise, a 425 Hz ring tone
(1 s on, 4 s off) and music (one instrumental track, pinned in the manifest).
A variant ("variants") places inserts at seconds of the base: at 0 before the
speech, elsewhere in a pause ("gaps": at a given second, or "near" one, in the
longest pause of the reference within 15 s of it, or the nearest pause when
there is none so close, never one pause twice; a music gap may take its
piece from a later second of the track, "from_s"). Writes into
$SONORUS_EVAL_CACHE/padded (default ~/.cache/sonorus-eval/padded), per base:

  base.wav, base.json           the base and its reference (language, words or sentences)
  <variant>.wav, <variant>.json the base with the variant's inserts; the
                                reference shifted by them, and where they are
                                (in the base, "at", and in the variant, "start"-"end")

Downloads (FLEURS archives ~180 MB per language, the music track 7.5 MB) are
checked against the sha256 in the manifest; the archives are deleted once the
utterances are taken out. --record fills in missing sha256 values and empty
utterance lists (picked from the dev split's table, see pick_utterances()).
The build is deterministic. Needs ffmpeg on PATH (decodes the music).

    .venv/bin/python scripts/eval/build_ami_set.py      # the AMI bases
    .venv/bin/python scripts/eval/build_padded_set.py
"""
import argparse
import csv
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_ami_set as ami_build  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "tests" / "quality" / "padded_manifest.json"
SAMPLE_RATE = ami_build.SAMPLE_RATE
FADE_S = 0.02


def cache_dir() -> Path:
    return Path(os.getenv("SONORUS_EVAL_CACHE", Path.home() / ".cache" / "sonorus-eval")) / "padded"


def db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-20))


def to_level(x: np.ndarray, level: float, dbfs: float) -> np.ndarray:
    return x * 10 ** ((dbfs - level) / 20)


def speech_level(x: np.ndarray, frame_s: float = 0.02, floor_db: float = 25.0) -> float:
    """Level of the speech in an utterance: RMS over the 20 ms frames within
    `floor_db` of the loudest one, so the silence around it does not count."""
    n = int(frame_s * SAMPLE_RATE)
    frames = x[:len(x) // n * n].reshape(-1, n)
    rms = np.sqrt(np.mean(frames ** 2, axis=1)) + 1e-20
    loud = rms >= rms.max() * 10 ** (-floor_db / 20)
    return float(20 * np.log10(np.sqrt(np.mean(rms[loud] ** 2))))


def fade(x: np.ndarray) -> np.ndarray:
    k = min(int(FADE_S * SAMPLE_RATE), len(x) // 2)
    if k:
        ramp = np.linspace(0, 1, k + 2)[1:-1]
        x = x.copy()
        x[:k] *= ramp
        x[-k:] *= ramp[::-1]
    return x


# ── inserts ──────────────────────────────────────────────────────────────────

def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(round(seconds * SAMPLE_RATE)))


def pink_noise(seconds: float, dbfs: float, seed: int) -> np.ndarray:
    n = int(round(seconds * SAMPLE_RATE))
    spectrum = np.fft.rfft(np.random.default_rng(seed).standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SAMPLE_RATE)
    spectrum[1:] /= np.sqrt(f[1:])
    spectrum[0] = 0
    x = np.fft.irfft(spectrum, n)
    return fade(to_level(x, db(x), dbfs))


def ring_tone(seconds: float, hz: float, on: float, off: float, dbfs: float) -> np.ndarray:
    """A ring-back tone: `on` seconds of a sine at `hz`, `off` seconds of silence,
    from the start; `dbfs` is the RMS while it sounds."""
    n = int(round(seconds * SAMPLE_RATE))
    x = np.zeros(n)
    beep = np.sin(2 * np.pi * hz * np.arange(int(on * SAMPLE_RATE)) / SAMPLE_RATE)
    beep = fade(to_level(beep, db(beep), dbfs))
    period = int((on + off) * SAMPLE_RATE)
    for start in range(0, n, period):
        piece = beep[:n - start]
        x[start:start + len(piece)] = piece
    return x


def make_insert(kind: str, seconds: float, spec: dict, music: np.ndarray | None) -> np.ndarray:
    if kind == "silence":
        return silence(seconds)
    if kind == "room":
        return pink_noise(seconds, spec["dbfs"], spec["seed"])
    if kind == "ring":
        return ring_tone(seconds, spec["hz"], spec["on"], spec["off"], spec["dbfs"])
    if kind == "music":
        n = int(round(seconds * SAMPLE_RATE))
        start = int(spec["from_s"] * SAMPLE_RATE)
        if music is None or len(music) < start + n:
            raise RuntimeError(f"music track shorter than {spec['from_s'] + seconds} s")
        x = music[start:start + n]
        return fade(to_level(x, db(x), spec["dbfs"]))
    raise ValueError(f"unknown insert {kind!r}")


# ── placing inserts and shifting the reference ───────────────────────────────

def shift_time(t: float, inserts: list[dict]) -> float:
    """Where a moment of the base lands once the inserts are in: every insert at
    or before it pushes it later."""
    return t + sum(i["seconds"] for i in inserts if i["at"] <= t)


def shift_reference(items: list[dict], inserts: list[dict]) -> list[dict]:
    """Words or sentences moved by the inserts before them; an item keeps its
    length (gaps go into pauses, never inside an item)."""
    out = []
    for item in items:
        d = shift_time(item["start"], inserts) - item["start"]
        out.append({**item, "start": round(item["start"] + d, 3), "end": round(item["end"] + d, 3)})
    return out


def place(base: np.ndarray, inserts: list[tuple[float, np.ndarray]]) -> np.ndarray:
    """The base with each insert put in at its second of the base."""
    parts, pos = [], 0
    for at, audio in sorted(inserts, key=lambda p: p[0]):
        cut = int(round(at * SAMPLE_RATE))
        parts += [base[pos:cut], audio]
        pos = cut
    parts.append(base[pos:])
    return np.concatenate(parts)


GAP_REACH_S = 15.0   # a gap "near" a second goes into the longest pause this close to it
MIN_PAUSE_S = 0.1    # shorter pauses between words are not taken


def pauses_of(items: list[dict]) -> list[tuple[float, float]]:
    """(middle, length) of every pause of the reference: no word or sentence,
    overlapping ones included, for at least MIN_PAUSE_S."""
    out, covered = [], None
    for item in sorted(items, key=lambda i: i["start"]):
        if covered is not None and item["start"] - covered >= MIN_PAUSE_S:
            out.append(((covered + item["start"]) / 2, item["start"] - covered))
        covered = item["end"] if covered is None else max(covered, item["end"])
    return out


def pause_near(items: list[dict], near: float, reach: float = GAP_REACH_S, taken=()) -> float:
    """The middle of the longest pause of the reference within `reach` of
    `near`; with none there (dense overlapping speech), the nearest pause.
    A pause in `taken` (middles) is never given twice."""
    free = [p for p in pauses_of(items) if all(abs(p[0] - t) > 1e-6 for t in taken)]
    if not free:
        raise RuntimeError(f"no free pause in the reference for a gap near {near} s")
    close = [p for p in free if abs(p[0] - near) <= reach]
    mid = max(close, key=lambda p: p[1])[0] if close else min(free, key=lambda p: abs(p[0] - near))[0]
    return round(mid, 3)


def variant_inserts(variant: dict, items: list[dict] | None = None) -> list[dict]:
    """The variant's inserts as {at, insert, seconds[, from_s]}: its lead-in at 0,
    then its gaps, each at a given second ("at") or in the pause of the
    reference `items` nearest to one ("near")."""
    lead = [{"at": 0.0, "insert": variant["insert"], "seconds": variant["seconds"]}] if variant.get("insert") else []
    gaps = []
    for g in variant.get("gaps", []):
        at = float(g["at"]) if "at" in g else pause_near(items or [], float(g["near"]),
                                                         taken=[x["at"] for x in gaps])
        gap = {"at": at, "insert": g["insert"], "seconds": g["seconds"]}
        if "from_s" in g:
            gap["from_s"] = g["from_s"]
        gaps.append(gap)
    return lead + sorted(gaps, key=lambda g: g["at"])


def insert_spans(inserts: list[dict]) -> list[tuple[float, float]]:
    """Where each insert sounds in the variant: (start, end) seconds."""
    spans, before = [], 0.0
    for i in sorted(inserts, key=lambda i: i["at"]):
        start = i["at"] + before
        spans.append((round(start, 3), round(start + i["seconds"], 3)))
        before += i["seconds"]
    return spans


# ── FLEURS ───────────────────────────────────────────────────────────────────

def read_table(tsv: bytes) -> list[dict]:
    """FLEURS table rows: sentence id, file, raw text, …, number of samples, gender."""
    rows = []
    for r in csv.reader(io.StringIO(tsv.decode("utf-8")), delimiter="\t", quoting=csv.QUOTE_NONE):
        rows.append({"sentence": int(r[0]), "file": r[1], "text": r[2], "samples": int(r[5]), "gender": r[6]})
    return rows


def pick_utterances(rows: list[dict], clips: int, seconds: float, pause: float) -> list[list[str]]:
    """Utterances for `clips` clips of about `seconds` each: one recording per
    sentence (no sentence twice), in sentence order, alternating female and
    male readers where the table allows."""
    by_sentence: dict[int, list[dict]] = {}
    for r in sorted(rows, key=lambda r: (r["sentence"], r["file"])):
        by_sentence.setdefault(r["sentence"], []).append(r)
    picked, current, length, want = [], [], 0.0, "FEMALE"
    for sentence in sorted(by_sentence):
        options = by_sentence[sentence]
        row = next((r for r in options if r["gender"] == want), options[0])
        current.append(row["file"])
        length += row["samples"] / SAMPLE_RATE + pause
        want = "MALE" if row["gender"] == "FEMALE" else "FEMALE"
        if length >= seconds:
            picked.append(current)
            current, length = [], 0.0
            if len(picked) == clips:
                return picked
    raise RuntimeError(f"not enough sentences for {clips} clips of {seconds} s")


def pauses(count: int, low: float, high: float) -> list[float]:
    """Fixed pauses between utterances, spread between low and high."""
    return [round(low + (high - low) * ((i * 7) % 10) / 9, 3) for i in range(count)]


def glue(utterances: list[tuple[str, np.ndarray]], gaps: list[float], dbfs: float) -> tuple[np.ndarray, list[dict]]:
    parts, sentences, t = [], [], 0.0
    for i, (text, x) in enumerate(utterances):
        x = to_level(x, speech_level(x), dbfs)
        parts.append(x)
        sentences.append({"text": text, "start": round(t, 3), "end": round(t + len(x) / SAMPLE_RATE, 3)})
        t += len(x) / SAMPLE_RATE
        if i < len(utterances) - 1:
            parts.append(silence(gaps[i]))
            t += gaps[i]
    return np.concatenate(parts), sentences


def read_wav(data: bytes) -> np.ndarray:
    offset, size = ami_build.data_chunk(data[:4096])
    return np.frombuffer(data[offset:offset + size], dtype="<i2").astype(np.float64) / 32768


def write(path: Path, x: np.ndarray) -> None:
    pcm = np.round(np.clip(x, -1, 32767 / 32768) * 32768).astype("<i2").tobytes()
    ami_build.write_wav(path, pcm)


def checked(path: Path, url: str, entry: dict, key: str, record: bool) -> bytes:
    if not path.exists():
        path.write_bytes(ami_build.fetch(url))
    data = path.read_bytes()
    digest = ami_build.sha256(data)
    if entry.get(key) is None and record:
        entry[key] = digest
    elif entry.get(key) != digest:
        sys.exit(f"{path.name}: sha256 {digest} does not match the manifest; delete it and retry")
    return data


def fleurs_language(manifest: dict, lang: str, out: Path, record: bool) -> dict[str, tuple[np.ndarray, list[dict]]]:
    """The glued clips of one language: {clip id: (audio, sentences)}."""
    spec, entry = manifest["fleurs"], manifest["fleurs"]["languages"][lang]
    folder = out / "fleurs" / entry["code"]
    folder.mkdir(parents=True, exist_ok=True)
    rows = {r["file"]: r for r in read_table(checked(
        folder / "dev.tsv", spec["tsv_url"].format(code=entry["code"]), entry, "tsv_sha256", record))}
    if record and not all(c["files"] for c in entry["clips"]):
        picks = pick_utterances(list(rows.values()), len(entry["clips"]), spec["clip_seconds"], spec["pause_s"][1])
        for clip, files in zip(entry["clips"], picks):
            clip["files"] = files
    wanted = {f for c in entry["clips"] for f in c["files"]}
    wav_dir = folder / "wav"
    if not all((wav_dir / f).exists() for f in wanted):
        archive = folder / "dev.tar.gz"
        checked(archive, spec["audio_url"].format(code=entry["code"]), entry, "audio_sha256", record)
        wav_dir.mkdir(exist_ok=True)
        with tarfile.open(archive) as tar:
            for member in tar:
                name = Path(member.name).name
                if member.isfile() and name in wanted:
                    (wav_dir / name).write_bytes(tar.extractfile(member).read())
        archive.unlink()
    clips = {}
    for clip in entry["clips"]:
        utterances = [(rows[f]["text"], decode(wav_dir / f)) for f in clip["files"]]
        gaps = pauses(len(utterances) - 1, *spec["pause_s"])
        clips[clip["id"]] = glue(utterances, gaps, manifest["speech_level_dbfs"])
    return clips


def decode(path: Path) -> np.ndarray:
    """Any audio file as 16 kHz mono samples (FLEURS stores 32-bit WAV, the music is MP3)."""
    pcm = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path), "-ac", "1",
                          "-ar", str(SAMPLE_RATE), "-f", "s16le", "-bitexact", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768


def decode_music(manifest: dict, out: Path, record: bool) -> np.ndarray:
    spec = manifest["music"]
    path = out / "music" / Path(spec["file"]).name
    path.parent.mkdir(parents=True, exist_ok=True)
    checked(path, spec["url"], spec, "sha256", record)
    return decode(path)


# ── bases and variants ───────────────────────────────────────────────────────

def load_bases(manifest: dict, out: Path, record: bool) -> dict[str, tuple[np.ndarray, dict]]:
    """{base id: (audio, reference)}; the reference has the language and either
    words (AMI) or sentences (FLEURS)."""
    ami_dir = ami_build.cache_dir()
    fleurs = {}
    bases = {}
    for base in manifest["bases"]:
        if base["source"] == "ami":
            wav = ami_dir / base["clip"] / base["file"]
            if not wav.exists():
                sys.exit(f"{wav} not built: run scripts/eval/build_ami_set.py first")
            words = json.loads((ami_dir / base["clip"] / "ref.json").read_text())["words"]
            bases[base["id"]] = (read_wav(wav.read_bytes()), {"language": base["language"], "words": words})
        elif base["source"] == "fleurs":
            lang = base["language"]
            if lang not in fleurs:
                fleurs[lang] = fleurs_language(manifest, lang, out, record)
            audio, sentences = fleurs[lang][base["id"]]
            bases[base["id"]] = (audio, {"language": lang, "sentences": sentences})
        else:
            raise ValueError(f"unknown base source {base['source']!r}")
    return bases


def build_variant(audio: np.ndarray, ref: dict, variant: dict, manifest: dict,
                  music: np.ndarray | None) -> tuple[np.ndarray, dict]:
    inserts = variant_inserts(variant, ref.get("words") or ref.get("sentences"))
    pieces = [(i["at"], make_insert(i["insert"], i["seconds"],
                                    {**manifest["inserts"][i["insert"]], **({"from_s": i["from_s"]} if "from_s" in i else {})},
                                    music))
              for i in inserts]
    spans = insert_spans(inserts)
    out = {"language": ref["language"], "variant": variant["name"],
           "inserts": [{**i, "start": a, "end": b} for i, (a, b) in zip(inserts, spans)]}
    for key in ("words", "sentences"):
        if key in ref:
            out[key] = shift_reference(ref[key], inserts)
    return place(audio, pieces), out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--record", action="store_true",
                        help="fill in missing sha256 values and utterance lists in the manifest")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH")
    manifest = json.loads(MANIFEST.read_text())
    out = cache_dir()
    out.mkdir(parents=True, exist_ok=True)

    music = decode_music(manifest, out, args.record)
    bases = load_bases(manifest, out, args.record)
    for base_id, (audio, ref) in bases.items():
        folder = out / base_id
        folder.mkdir(exist_ok=True)
        write(folder / "base.wav", audio)
        (folder / "base.json").write_text(json.dumps({**ref, "variant": "base", "inserts": []}, indent=1,
                                                     ensure_ascii=False))
        for variant in manifest["variants"]:
            x, vref = build_variant(audio, ref, variant, manifest, music)
            write(folder / f"{variant['name']}.wav", x)
            (folder / f"{variant['name']}.json").write_text(json.dumps(vref, indent=1, ensure_ascii=False))
        print(f"{base_id}: {len(audio) / SAMPLE_RATE:.0f} s, {len(manifest['variants'])} variants → {folder}")

    if args.record:
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"set ready in {out}")


if __name__ == "__main__":
    main()
