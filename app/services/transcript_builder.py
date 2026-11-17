import uuid

from ..models.transcript import Transcript
from ..models.segment import Segment
from typing import List, Dict, Any

from app.logger import get_logger

log = get_logger("TranscriptBuilder")

# A Whisper segment is a sentence; when its words belong to different
# diarization speakers it is cut into one segment per speaker. Off only to
# measure the difference in the quality tests.
SPLIT_AT_WORD_SPEAKERS = True
# A run of words of one speaker becomes a segment of its own only with at
# least this many words and seconds; a shorter run is more often the
# diarization placing a turn boundary a few words off than an utterance.
# 1.0 s was best on the AMI quality set (0.5 s cut such misplaced words
# away from the sentence; the word count changed little).
MIN_PIECE_WORDS = 2
MIN_PIECE_SECONDS = 1.0
# WhisperX aligns these per character: a "word" is one character.
LANGUAGES_WITHOUT_SPACES = ("ja", "zh")


class TranscriptBuilder:
    @staticmethod
    def build(result: dict, speaker_map: Dict[str, str], audio_path: str) -> Transcript:

        segments = []
        # Diarization speakers that resolve() did not map (no embedding: too
        # little speech) still get a stable id, one per label — raw SPEAKER_XX
        # labels are unstable across runs and are never persisted as speakers.
        speaker_map = dict(speaker_map)

        language = result.get("language")
        pieces = []
        for seg in result["segments"]:
            split = split_by_word_speakers(seg, language) if SPLIT_AT_WORD_SPEAKERS else None
            pieces += split or [seg]

        for seg in pieces:
            raw_speaker = seg.get("speaker", "UNKNOWN")

            if raw_speaker not in speaker_map and raw_speaker.startswith("SPEAKER_"):
                speaker_map[raw_speaker] = str(uuid.uuid4())
                log.info(f"{raw_speaker} → {speaker_map[raw_speaker]} (new, no embedding)")
            resolved = speaker_map.get(raw_speaker)

            segment = Segment(
                start=seg["start"],
                end=seg["end"],
                text=seg["text"].strip(),

                speaker_raw=raw_speaker,
                speaker_resolved=resolved,

                speaker_final=None,
                # no diarization speaker at all — the user assigns one
                unassigned=resolved is None,
            )

            segments.append(segment)

        transcript = Transcript(
            segments=segments,
            audio_path=audio_path,
            language=result.get("language", "unknown"),
            status="draft"
        )
        log.info(f"Built transcript — {len(segments)} segments, language={transcript.language}")
        return transcript

    @staticmethod
    def attach_embeddings(
        transcript: Transcript,
        segment_embeddings: List[Dict[str, Any]],
    ) -> Transcript:
        """Assigns each segment the embedding of the diarization turn of the SAME
        speaker (segment.speaker_raw) with the largest time overlap.

        A Whisper segment can span a speaker change; taking the turn with the
        largest overlap regardless of speaker would attach another person's
        voice and contaminate this speaker's profile on commit. No overlapping
        turn of the same speaker → embedding stays None.
        """
        by_speaker: Dict[str, List[Dict[str, Any]]] = {}
        for emb in segment_embeddings:
            by_speaker.setdefault(emb["speaker"], []).append(emb)

        for seg in transcript.segments:
            best_match = None
            best_overlap = 0.0

            for emb in by_speaker.get(seg.speaker_raw, ()):
                overlap = max(0.0, min(seg.end, emb["end"]) - max(seg.start, emb["start"]))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_match = emb

            if best_match:
                seg.embedding = best_match["embedding"]

        n_attached = sum(1 for seg in transcript.segments if seg.embedding is not None)
        log.debug(f"Attached embeddings to {n_attached}/{len(transcript.segments)} segments")
        return transcript


def split_by_word_speakers(seg: dict, language: str | None = None) -> List[dict] | None:
    """Cuts a WhisperX segment where the speaker of its words changes.

    Returns the pieces as {start, end, text, speaker} in order, or None when
    the segment stays whole: no words with a speaker, or one speaker once
    runs shorter than MIN_PIECE_WORDS / MIN_PIECE_SECONDS joined a neighbour.
    Words without a speaker (no time, or in a diarization gap) go with the
    words before them, at the start with the words after them.
    """
    words = seg.get("words") or []
    runs = _speaker_runs(words)
    if runs is None:
        return None
    _merge_short_runs(runs, words)
    if len(runs) < 2:
        return None

    text = seg.get("text", "")
    offsets = _word_offsets(text, words)
    sep = "" if language in LANGUAGES_WITHOUT_SPACES else " "
    pieces: List[dict] = []
    for k, run in enumerate(runs):
        lo, hi = run["lo"], run["hi"]
        if offsets is not None:
            a = 0 if k == 0 else offsets[lo]
            b = offsets[hi] if hi < len(words) else len(text)
            piece_text = text[a:b].strip()
        else:
            piece_text = sep.join(w["word"].strip() for w in words[lo:hi])
        start, end = _run_span(run, words)
        if k == 0:
            start = seg["start"]
        if k == len(runs) - 1:
            end = seg["end"]
        if pieces and start <= pieces[-1]["start"]:
            # Alignment gave no distinct time: a segment is identified by its
            # start, so this piece cannot stand alone.
            prev = pieces[-1]
            prev["text"] = (prev["text"] + sep + piece_text).strip()
            prev["end"] = float(max(prev["end"], end))
            continue
        if pieces:
            pieces[-1]["end"] = float(min(pieces[-1]["end"], start))
        pieces.append({"start": float(start), "end": float(end), "text": piece_text, "speaker": run["speaker"]})
    return pieces if len(pieces) > 1 else None


def _speaker_runs(words: List[dict]) -> List[dict] | None:
    """Consecutive words of one speaker as {speaker, lo, hi} (word index range)."""
    first = next((w["speaker"] for w in words if w.get("speaker")), None)
    if first is None:
        return None
    runs: List[dict] = []
    current = first
    for i, w in enumerate(words):
        current = w.get("speaker") or current
        if runs and runs[-1]["speaker"] == current:
            runs[-1]["hi"] = i + 1
        else:
            runs.append({"speaker": current, "lo": i, "hi": i + 1})
    return runs


def _run_span(run: dict, words: List[dict]) -> tuple:
    # Every run holds a word with a speaker, and such a word has a start.
    timed = [w for w in words[run["lo"]:run["hi"]] if "start" in w]
    return min(w["start"] for w in timed), max(w.get("end", w["start"]) for w in timed)


def _is_short(run: dict, words: List[dict]) -> bool:
    start, end = _run_span(run, words)
    return run["hi"] - run["lo"] < MIN_PIECE_WORDS or end - start < MIN_PIECE_SECONDS


def _merge_short_runs(runs: List[dict], words: List[dict]) -> None:
    """Gives each too-short run to a neighbour, shortest first, until none is left."""
    while len(runs) > 1:
        short = [i for i, r in enumerate(runs) if _is_short(r, words)]
        if not short:
            return
        i = min(short, key=lambda k: (_run_span(runs[k], words)[1] - _run_span(runs[k], words)[0], k))
        if i == 0:
            j = 1
        elif i == len(runs) - 1:
            j = i - 1
        else:
            start, end = _run_span(runs[i], words)
            gap_before = start - _run_span(runs[i - 1], words)[1]
            gap_after = _run_span(runs[i + 1], words)[0] - end
            j = i - 1 if gap_before <= gap_after else i + 1
        runs[i]["speaker"] = runs[j]["speaker"]
        # join every neighbouring run of the same speaker (both sides when
        # the short run sat between two runs of one person)
        merged: List[dict] = []
        for r in runs:
            if merged and merged[-1]["speaker"] == r["speaker"]:
                merged[-1]["hi"] = r["hi"]
            else:
                merged.append(dict(r))
        runs[:] = merged


def _word_offsets(text: str, words: List[dict]) -> List[int] | None:
    """Position of each word in the segment text, in order; None if one is missing."""
    offsets, pos = [], 0
    for w in words:
        token = w["word"].strip()
        k = text.find(token, pos)
        if k < 0 or not token:
            return None
        offsets.append(k)
        pos = k + len(token)
    return offsets
