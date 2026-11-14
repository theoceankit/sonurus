#!/usr/bin/env python3
"""Recompute speaker recognition of a quality run for other thresholds and
ways of averaging voices, without running the models again.

Reads <report>.json and <report>.npz written by tests/quality (the voices of
every clip: diarization turns with their embeddings, and which turn each
transcript segment carries) and replays every series as the app would: the
memory matches each clip's speakers (SpeakerMemoryService's resolver), the
queue commits the recognised ones, naming assigns the named clips' speakers,
profiles are the centroid of per-recording centroids with the threshold as
guard (CommitService). Only the matching and averaging change; diarization
and embeddings are those of the run.

    .venv/bin/python scripts/eval/threshold_sweep.py ~/.cache/sonorus-eval/reports/<stem>.json

Methods of averaging embeddings (a recording's voice of a speaker, and the
per-recording centroid of a profile):

  mean        the plain mean of the embeddings (the app today)
  norm        each embedding scaled to length 1 first
  norm+dur    as norm, weighted by the duration of the diarization turn
"""
import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

METHODS = ("mean", "norm", "norm+dur")
THRESHOLDS = tuple(round(0.40 + 0.05 * k, 2) for k in range(9))  # 0.40 … 0.80


def _unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def average(embeddings: np.ndarray, durations: np.ndarray, method: str) -> np.ndarray:
    """One vector from several embeddings (rows), by the given method."""
    if method == "mean":
        return embeddings.mean(axis=0)
    unit = embeddings / np.maximum(np.linalg.norm(embeddings, axis=1, keepdims=True), 1e-12)
    if method == "norm":
        return unit.mean(axis=0)
    if method == "norm+dur":
        return (unit * durations[:, None]).sum(axis=0) / durations.sum()
    raise ValueError(method)


@dataclass
class Clip:
    """One clip's voices from the .npz."""
    name: str
    named_here: bool
    turn_speaker: np.ndarray    # raw diarization label per turn
    turn_ref: np.ndarray        # who it really is ("" = nobody)
    turn_duration: np.ndarray
    turn_embedding: np.ndarray
    segment_turn: np.ndarray    # turn each transcript segment carries, -1 = none

    def ref_of(self, raw: str) -> str | None:
        refs = self.turn_ref[self.turn_speaker == raw]
        return str(refs[0]) if len(refs) and refs[0] else None

    def session(self, method: str) -> dict[str, np.ndarray]:
        """What EmbeddingService.extract_all hands to resolve(): a voice per raw speaker."""
        return {str(raw): average(self.turn_embedding[self.turn_speaker == raw],
                                  self.turn_duration[self.turn_speaker == raw], method)
                for raw in dict.fromkeys(self.turn_speaker)}

    def segments_of(self, raw: str) -> np.ndarray:
        """Turn indices of the transcript segments of a raw speaker (what the DB holds)."""
        turns = self.segment_turn[self.segment_turn >= 0]
        return turns[self.turn_speaker[turns] == raw]


@dataclass
class Memory:
    """Speaker profiles by person, rebuilt from per-recording segment embeddings
    the way CommitService does it."""
    threshold: float
    method: str
    profiles: dict[str, np.ndarray] = field(default_factory=dict)
    db: dict[str, dict[str, tuple[np.ndarray, np.ndarray]]] = field(default_factory=dict)

    def add(self, person: str, clip: str, embeddings: np.ndarray, durations: np.ndarray) -> None:
        if len(embeddings):
            self.db.setdefault(person, {})[clip] = (embeddings, durations)

    def remove(self, person: str, clip: str) -> None:
        self.db.get(person, {}).pop(clip, None)

    def recompute(self, person: str) -> None:
        guard = self.profiles.get(person)
        centroids = []
        for embs, durs in self.db.get(person, {}).values():
            c = _unit(average(embs, durs, self.method))
            if guard is not None and float(np.dot(c, guard)) < self.threshold:
                continue
            centroids.append(c)
        if centroids:
            self.profiles[person] = _unit(np.mean(centroids, axis=0))


@dataclass
class Outcome:
    recognised: int = 0
    total: int = 0      # people of non-named clips who have a profile
    wrong: int = 0      # false matches, in every clip
    own: list = field(default_factory=list)
    other: list = field(default_factory=list)

    def __iadd__(self, o: "Outcome"):
        self.recognised += o.recognised
        self.total += o.total
        self.wrong += o.wrong
        self.own += o.own
        self.other += o.other
        return self


def replay(clips: list[Clip], threshold: float, method: str) -> Outcome:
    from app.services.speaker_memory_service import _resolve_speakers

    memory, out = Memory(threshold, method), Outcome()
    for clip in clips:
        session = clip.session(method)
        matched = _resolve_speakers(session, memory.profiles, threshold)
        matched = {raw: (m if m in memory.profiles else None) for raw, m in matched.items()}
        for raw, person in matched.items():
            ref = clip.ref_of(raw)
            if ref is None:
                continue
            if person is not None and person != ref:
                out.wrong += 1
            if not clip.named_here and ref in memory.profiles:
                out.total += 1
                out.recognised += person == ref
                out.own.append(float(np.dot(_unit(session[raw]), memory.profiles[ref])))
                out.other.append(max((float(np.dot(_unit(session[raw]), p))
                                      for n, p in memory.profiles.items() if n != ref), default=np.nan))
        # The queue commits the recognised speakers (with the guard).
        for raw, person in matched.items():
            if person is not None:
                turns = clip.segments_of(raw)
                memory.add(person, clip.name, clip.turn_embedding[turns], clip.turn_duration[turns])
                memory.recompute(person)
        if clip.named_here:
            # Naming: every raw speaker's segments go to the person they are.
            for raw, person in matched.items():
                ref = clip.ref_of(raw)
                if ref is None or ref == person:
                    continue
                turns = clip.segments_of(raw)
                if person is not None:
                    memory.remove(person, clip.name)
                    memory.recompute(person)
                memory.add(ref, clip.name, clip.turn_embedding[turns], clip.turn_duration[turns])
                memory.recompute(ref)
    return out


def load(report_json: Path) -> dict[tuple[str, str], list[Clip]]:
    """{(series, variant): clips in run order} of a quality report."""
    from tests.quality.report import voices_key

    data = json.loads(report_json.read_text())
    arrays = np.load(report_json.with_suffix(".npz"))
    runs = {}
    for row in data["variants"]:
        series, variant = row.get("series"), row["variant"]
        clips = []
        for c in row["clips"]:
            def a(f, c=c):
                return arrays[voices_key(series, variant, c["clip"], f)]
            if voices_key(series, variant, c["clip"], "turn_speaker") not in arrays:
                break
            clips.append(Clip(c["clip"], c.get("named_here", not clips), a("turn_speaker"), a("turn_ref"),
                              a("turn_end") - a("turn_start"), a("turn_embedding").astype(np.float64),
                              a("segment_turn")))
        else:
            runs[(series or "", variant)] = clips
    return runs


def _q(xs, q):
    xs = [x for x in xs if not np.isnan(x)]
    return f"{np.quantile(xs, q):.2f}" if xs else "–"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("report", type=Path, help="<stem>.json of a quality run (the .npz next to it)")
    parser.add_argument("--thresholds", type=float, nargs="*", default=THRESHOLDS)
    parser.add_argument("--methods", nargs="*", default=METHODS, choices=METHODS)
    args = parser.parse_args()
    from app.config import SPEAKER_SIMILARITY_THRESHOLD

    runs = load(args.report)
    if not runs:
        sys.exit(f"no voices in {args.report.with_suffix('.npz')}")
    print(f"{len(runs)} runs: " + ", ".join(f"{s or 'fast'}/{v}" for s, v in runs))

    print("\n## All runs: recognised / total, wrong\n")
    print("| Threshold | " + " | ".join(args.methods) + " |")
    print("|---|" + "---|" * len(args.methods))
    for t in args.thresholds:
        cells = []
        for m in args.methods:
            total = Outcome()
            for clips in runs.values():
                total += replay(clips, t, m)
            cells.append(f"{total.recognised} / {total.total}, {total.wrong}")
        print(f"| {t:.2f} | " + " | ".join(cells) + " |")

    print(f"\n## Per run at {SPEAKER_SIMILARITY_THRESHOLD} (the app's threshold): own and best other similarity\n")
    print("| Run | Method | Recognised | Wrong | Own min / p10 / median | Other median / p90 / max |")
    print("|---|---|---|---|---|---|")
    for (series, variant), clips in runs.items():
        for m in args.methods:
            o = replay(clips, SPEAKER_SIMILARITY_THRESHOLD, m)
            print(f"| {series or 'fast'}/{variant} | {m} | {o.recognised} / {o.total} | {o.wrong} "
                  f"| {_q(o.own, 0)} / {_q(o.own, .1)} / {_q(o.own, .5)} "
                  f"| {_q(o.other, .5)} / {_q(o.other, .9)} / {_q(o.other, 1)} |")


if __name__ == "__main__":
    main()
