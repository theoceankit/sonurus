"""Transcript quality metrics against a reference: WER, speaker mapping and
accuracy, missed utterances, speaker recognition across files.

Pure Python + numpy/scipy (both in requirements-test.txt), no ML libraries:
the quality tests (tests/quality/) and the e2e UI test use the same functions.
"""
import math
import re
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

# Hesitations and backchannels: AMI transcribes them, Whisper mostly drops them.
# Removed on both sides so they count neither as errors nor as words.
FILLERS = frozenset({
    "um", "umm", "uh", "uhm", "uhh", "er", "erm", "ah", "eh", "oh", "hmm", "hm",
    "mm", "mmm", "huh",
})

_TOKEN = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)*")


def normalize(text: str) -> list[str]:
    """Lowercase words without punctuation and fillers; hyphens split words."""
    words = _TOKEN.findall(text.lower().replace("-", " "))
    return [w for w in words if w not in FILLERS]


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float
    speaker: str | None


# ── WER ──────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WerResult:
    substitutions: int
    deletions: int
    insertions: int
    ref_words: int

    @property
    def errors(self) -> int:
        return self.substitutions + self.deletions + self.insertions

    @property
    def wer(self) -> float:
        return self.errors / self.ref_words if self.ref_words else float(self.errors > 0)


def align(ref: list[str], hyp: list[str]) -> list[tuple[str, int | None, int | None]]:
    """Levenshtein alignment: (op, ref_index, hyp_index), op in equal/substitute/delete/insert."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i, j] = min(d[i - 1, j - 1] + cost, d[i - 1, j] + 1, d[i, j - 1] + 1)
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            pairs.append(("equal" if ref[i - 1] == hyp[j - 1] else "substitute", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and d[i, j] == d[i - 1, j] + 1:
            pairs.append(("delete", i - 1, None))
            i -= 1
        else:
            pairs.append(("insert", None, j - 1))
            j -= 1
    return pairs[::-1]


def wer(ref: list[str], hyp: list[str]) -> WerResult:
    ops = [op for op, _, _ in align(ref, hyp)]
    return WerResult(ops.count("substitute"), ops.count("delete"), ops.count("insert"), len(ref))


# ── speakers ─────────────────────────────────────────────────────────────────

def _overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def map_speakers(ref_turns, hyp_turns) -> dict[str, str | None]:
    """One-to-one hyp → ref speaker mapping maximising overlapping time.

    Turns are (speaker, start, end). A hyp speaker left without a partner
    (more hyp than ref speakers, or no overlap) maps to None.
    """
    ref_ids = sorted({s for s, _, _ in ref_turns})
    hyp_ids = sorted({s for s, _, _ in hyp_turns})
    cost = np.zeros((len(hyp_ids), len(ref_ids)))
    for hs, h0, h1 in hyp_turns:
        for rs, r0, r1 in ref_turns:
            cost[hyp_ids.index(hs), ref_ids.index(rs)] -= _overlap(h0, h1, r0, r1)
    mapping = {h: None for h in hyp_ids}
    for hi, ri in zip(*linear_sum_assignment(cost)):
        if cost[hi, ri] < 0:
            mapping[hyp_ids[hi]] = ref_ids[ri]
    return mapping


def turns(words: list[Word]) -> list[tuple[str, float, float]]:
    return [(w.speaker, w.start, w.end) for w in words if w.speaker is not None]


def speaker_accuracy(ref: list[Word], hyp: list[Word], mapping: dict) -> float:
    """Share of aligned word pairs (equal or substituted) with the right speaker."""
    pairs = [(i, j) for op, i, j in align([w.text for w in ref], [w.text for w in hyp])
             if op in ("equal", "substitute")]
    if not pairs:
        return 0.0
    right = sum(1 for i, j in pairs if mapping.get(hyp[j].speaker) == ref[i].speaker)
    return right / len(pairs)


def segment_words(segments) -> list[Word]:
    """Words of (speaker, start, end, text) segments; times spread evenly over the words."""
    out = []
    for speaker, start, end, text in segments:
        words = normalize(text)
        step = (end - start) / len(words) if words else 0
        out += [Word(w, start + k * step, start + (k + 1) * step, speaker) for k, w in enumerate(words)]
    return out


def ref_words(reference: list[dict]) -> list[Word]:
    """Reference JSON words ({word, start, end, speaker}) → normalised Words."""
    out = []
    for r in reference:
        out += [Word(w, r["start"], r["end"], r["speaker"]) for w in normalize(r["word"])]
    return out


# ── utterances ───────────────────────────────────────────────────────────────

@dataclass
class Utterance:
    speaker: str
    words: list[Word] = field(default_factory=list)

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return self.words[-1].end


def utterances(words: list[Word], max_gap: float = 1.0) -> list[Utterance]:
    """Runs of one speaker's words in time order; a pause longer than max_gap
    or a word of another speaker starts a new utterance."""
    out: list[Utterance] = []
    for w in sorted(words, key=lambda w: w.start):
        if not out or out[-1].speaker != w.speaker or w.start - out[-1].end > max_gap:
            out.append(Utterance(w.speaker))
        out[-1].words.append(w)
    return out


def missed_utterances(ref: list[Word], hyp: list[Word], utts: list[Utterance], found_share: float = 0.5):
    """Reference utterances of which less than found_share of the words were recognised."""
    found = {i for op, i, _ in align([w.text for w in ref], [w.text for w in hyp]) if op == "equal"}
    index = {id(w): k for k, w in enumerate(ref)}
    return [u for u in utts
            if sum(index[id(w)] in found for w in u.words) < found_share * len(u.words)]


# ── audio and embeddings ─────────────────────────────────────────────────────

def rms_dbfs(samples) -> float:
    rms = float(np.sqrt(np.mean(np.square(np.asarray(samples, dtype=np.float64))))) if len(samples) else 0.0
    return 20 * math.log10(rms) if rms > 0 else -math.inf


def cosine(a, b) -> float:
    a, b = np.asarray(a, dtype=np.float64).ravel(), np.asarray(b, dtype=np.float64).ravel()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


@dataclass(frozen=True)
class Recognition:
    correct: int  # matched to the right named speaker
    wrong: int    # matched to another named speaker
    new: int      # not matched, though this person is named


def recognition(hyp_to_ref: dict, hyp_to_known: dict) -> Recognition:
    """hyp_to_ref: who each hyp speaker really is; hyp_to_known: whom memory matched (None = nobody).

    Hyp speakers without a reference partner are left out.
    """
    correct = wrong = new = 0
    for hyp, ref in hyp_to_ref.items():
        if ref is None:
            continue
        known = hyp_to_known.get(hyp)
        if known is None:
            new += 1
        elif known == ref:
            correct += 1
        else:
            wrong += 1
    return Recognition(correct, wrong, new)
