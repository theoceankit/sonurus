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

    .venv/bin/python scripts/eval/threshold_sweep.py ~/.cache/sonorus-eval/reports/<stem>.json [<stem>.json …]

Several reports are read together (e.g. the fast set and the long set, or a
long set run in parts); a run of the same series and variant in a later
report replaces the earlier one.

Methods of averaging embeddings (a recording's voice of a speaker, and the
per-recording centroid of a profile):

  mean        the plain mean of the embeddings (the app today)
  norm        each embedding scaled to length 1 first
  norm+dur    as norm, weighted by the duration of the diarization turn
  turns       a recording's voice as norm+dur over its diarization turns; a
              profile's per-recording centroid as norm over the segments that
              carry an embedding (a turn split into several segments counts
              that many times) — what the app can do with what the DB holds
  one         one vector definition: the voice resolve() compares, a profile's
              per-recording centroid and so the guard are all norm+dur over
              the diarization turns, each turn once however many segments
              carry it

Every other method counts a turn once per segment that carries it in a
profile, as the app does.

Matching a recording's voices to the profiles (--matchers):

  greedy      the highest pair first, one to one (the app today)
  hungarian   the one-to-one assignment with the largest sum of similarities
              among pairs at or above the threshold

A match is possible (the Editor asks to confirm it) when its similarity is
below POSSIBLE_MATCH_CEILING, as in the app, or, with a margin (--margins),
when the voice is closer than the margin to the next best profile. The
tables split recognised and wrong matches into sure and possible ones.
"""
import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

METHODS = ("mean", "norm", "norm+dur", "turns", "one")
MATCHERS = ("greedy", "hungarian")
MARGINS = (0.0, 0.05, 0.1)
# method → (a recording's voice, a profile's per-recording centroid)
_AVERAGING = {"mean": ("mean", "mean"), "norm": ("norm", "norm"),
              "norm+dur": ("norm+dur", "norm+dur"), "turns": ("norm+dur", "norm"), "one": ("norm+dur", "norm+dur")}
_ONCE_PER_TURN = {"one"}
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
        voice = _AVERAGING[method][0]
        return {str(raw): average(self.turn_embedding[self.turn_speaker == raw],
                                  self.turn_duration[self.turn_speaker == raw], voice)
                for raw in dict.fromkeys(self.turn_speaker)}

    def segments_of(self, raw: str) -> np.ndarray:
        """Turn indices of the transcript segments of a raw speaker (what the DB holds)."""
        turns = self.segment_turn[self.segment_turn >= 0]
        return turns[self.turn_speaker[turns] == raw]

    def profile_turns(self, raw: str, method: str) -> np.ndarray:
        """The turns a raw speaker's segments give a profile: one per segment,
        or each turn once with a method that counts turns once."""
        turns = self.segments_of(raw)
        return np.unique(turns) if method in _ONCE_PER_TURN else turns


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
    possible: int = 0   # recognised, but as a possible match
    wrong_sure: int = 0  # false matches that are not possible matches
    own: list = field(default_factory=list)
    other: list = field(default_factory=list)

    def __iadd__(self, o: "Outcome"):
        self.recognised += o.recognised
        self.total += o.total
        self.wrong += o.wrong
        self.possible += o.possible
        self.wrong_sure += o.wrong_sure
        self.own += o.own
        self.other += o.other
        return self


def _ceiling() -> float:
    from app.config import POSSIBLE_MATCH_CEILING
    return POSSIBLE_MATCH_CEILING


def match_scores(scores: np.ndarray, threshold: float, matcher: str = "greedy",
                 margin: float = 0.0, ceiling: float | None = None) -> dict[int, tuple[int, float, bool]]:
    """Match rows (a recording's voices) to columns (profiles) by their
    similarities: {row: (column, similarity, sure)}. A match is not sure when
    it is below the ceiling (two digits, as the app compares) or, with a
    margin above 0, less than margin above the row's best other column."""
    ceiling = _ceiling() if ceiling is None else ceiling
    pairs: list[tuple[int, int]] = []
    if scores.size:
        if matcher == "greedy":
            taken_r, taken_c = set(), set()
            order = sorted(((float(scores[i, j]), i, j) for i in range(scores.shape[0])
                            for j in range(scores.shape[1])), reverse=True)
            for s, i, j in order:
                if s < threshold:
                    break
                if i in taken_r or j in taken_c:
                    continue
                pairs.append((i, j))
                taken_r.add(i)
                taken_c.add(j)
        elif matcher == "hungarian":
            from scipy.optimize import linear_sum_assignment
            weights = np.where(scores >= threshold, scores, 0.0)
            rows, cols = linear_sum_assignment(weights, maximize=True)
            pairs = [(int(i), int(j)) for i, j in zip(rows, cols) if scores[i, j] >= threshold]
        else:
            raise ValueError(matcher)
    out = {}
    for i, j in pairs:
        s = float(scores[i, j])
        others = np.delete(scores[i], j)
        second = float(others.max()) if others.size else -1.0
        sure = round(s, 2) >= ceiling and (margin <= 0 or s - second >= margin)
        out[i] = (j, s, sure)
    return out


def match(session: dict, profiles: dict, threshold: float, matcher: str = "greedy",
          margin: float = 0.0, ceiling: float | None = None) -> dict[str, tuple[str, float, bool]]:
    """match_scores over named voices and profiles: {raw: (person, similarity, sure)}."""
    raws, people = list(session), list(profiles)
    if not raws or not people:
        return {}
    voices = np.stack([_unit(session[r]) for r in raws])
    scores = voices @ np.stack([_unit(profiles[p]) for p in people]).T
    return {raws[i]: (people[j], s, sure)
            for i, (j, s, sure) in match_scores(scores, threshold, matcher, margin, ceiling).items()}


def replay(clips: list[Clip], threshold: float, method: str, matcher: str = "greedy",
           margin: float = 0.0, ceiling: float | None = None) -> Outcome:
    _, centroid = _AVERAGING[method]
    memory, out = Memory(threshold, centroid), Outcome()
    for clip in clips:
        session = clip.session(method)
        found = match(session, memory.profiles, threshold, matcher, margin, ceiling)
        matched = {raw: (found[raw][0] if raw in found else None) for raw in session}
        for raw, person in matched.items():
            ref = clip.ref_of(raw)
            if ref is None:
                continue
            sure = raw in found and found[raw][2]
            if person is not None and person != ref:
                out.wrong += 1
                out.wrong_sure += sure
            if not clip.named_here and ref in memory.profiles:
                out.total += 1
                out.recognised += person == ref
                out.possible += person == ref and not sure
                out.own.append(float(np.dot(_unit(session[raw]), memory.profiles[ref])))
                out.other.append(max((float(np.dot(_unit(session[raw]), p))
                                      for n, p in memory.profiles.items() if n != ref), default=np.nan))
        # The queue commits the recognised speakers (with the guard).
        for raw, person in matched.items():
            if person is not None:
                turns = clip.profile_turns(raw, method)
                memory.add(person, clip.name, clip.turn_embedding[turns], clip.turn_duration[turns])
                memory.recompute(person)
        if clip.named_here:
            # Naming: every raw speaker's segments go to the person they are.
            for raw, person in matched.items():
                ref = clip.ref_of(raw)
                if ref is None or ref == person:
                    continue
                turns = clip.profile_turns(raw, method)
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
    parser.add_argument("reports", type=Path, nargs="+",
                        help="<stem>.json of quality runs (the .npz next to each)")
    parser.add_argument("--thresholds", type=float, nargs="*", default=THRESHOLDS)
    parser.add_argument("--methods", nargs="*", default=METHODS, choices=METHODS)
    parser.add_argument("--matchers", nargs="*", default=MATCHERS, choices=MATCHERS)
    parser.add_argument("--margins", type=float, nargs="*", default=MARGINS)
    args = parser.parse_args()
    from app.config import SPEAKER_SIMILARITY_THRESHOLD

    runs = {}
    for report in args.reports:
        runs.update(load(report))
    if not runs:
        sys.exit("no voices in " + ", ".join(str(r.with_suffix(".npz")) for r in args.reports))
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

    def total(t, m, matcher="greedy", margin=0.0, of=None):
        out = Outcome()
        for key, clips in runs.items():
            if of is None or key in of:
                out += replay(clips, t, m, matcher, margin)
        return out

    combos = [(mt, mg) for mt in args.matchers for mg in args.margins]
    for m in args.methods:
        print(f"\n## {m}, matchers and margins: recognised (possible) / total, wrong (sure)\n")
        print("| Threshold | " + " | ".join(f"{mt}, margin {mg:.2f}" for mt, mg in combos) + " |")
        print("|---|" + "---|" * len(combos))
        for t in args.thresholds:
            cells = []
            for mt, mg in combos:
                o = total(t, m, mt, mg)
                cells.append(f"{o.recognised} ({o.possible}) / {o.total}, {o.wrong} ({o.wrong_sure})")
            print(f"| {t:.2f} | " + " | ".join(cells) + " |")

    calls = [k for k in runs if k[0] in ("", "3 min") and k[1] == "call"]
    if calls:
        names = ", ".join(f"{s or 'fast'}/{v}" for s, v in calls)
        print(f"\n## 3-minute call clips ({names}) at {SPEAKER_SIMILARITY_THRESHOLD}: own and best other similarity\n")
        print("| Method | Recognised | Own min / p10 / median | Other median / max |")
        print("|---|---|---|---|")
        for m in args.methods:
            o = total(SPEAKER_SIMILARITY_THRESHOLD, m, of=calls)
            print(f"| {m} | {o.recognised} / {o.total} | {_q(o.own, 0)} / {_q(o.own, .1)} / {_q(o.own, .5)} "
                  f"| {_q(o.other, .5)} / {_q(o.other, 1)} |")

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
