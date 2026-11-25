"""A recording as the editor shows it, for tools that give it out as text: the
effective speaker of a segment, the labels of speakers without a name, turns
and the text of Copy transcript.

Ports of ui/src/api/types.ts (effectiveSpeaker) and
ui/src/screens/Editor/transcript.ts (unknownSpeakerNames, buildTurns,
transcriptText): an agent reads and writes what the user sees. The fixtures in
tests/fixtures/transcript keep the two alike; the editor is the reference.
"""
from __future__ import annotations

from collections.abc import Iterable, Set
from dataclasses import dataclass, field
from typing import Literal

from app.models.segment import UNASSIGNED, Segment
from app.services.note_markdown import NoteSpeaker, NoteSpeakers


def effective_speaker(segment: Segment) -> str:
    """UNASSIGNED if the segment waits for a speaker, else the user's choice,
    then the match from memory, then diarization (invariant 3)."""
    if segment.unassigned:
        return UNASSIGNED
    return segment.speaker_final or segment.speaker_resolved or segment.speaker_raw


def unknown_speaker_names(segments: Iterable[Segment], named: Set[str]) -> dict[str, str]:
    """{speaker id: "Unknown speaker N"} for each speaker of the segments who is
    not in named (ids of speakers with a name), numbered in the order they
    first speak. Segments in order of time."""
    names: dict[str, str] = {}
    for segment in segments:
        spk_id = effective_speaker(segment)
        if spk_id != UNASSIGNED and spk_id not in named and spk_id not in names:
            names[spk_id] = f"Unknown speaker {len(names) + 1}"
    return names


@dataclass(frozen=True)
class TurnSpeaker:
    """Who speaks a turn: a named speaker, an unknown one by their label in this
    recording, or the unassigned segments."""
    id: str
    kind: Literal["named", "unknown", "unassigned"]
    name: str
    handle: str | None = None


@dataclass
class Turn:
    """Neighbouring segments of one speaker, shown as one turn."""
    speaker: TurnSpeaker
    start: float
    segments: list[Segment] = field(default_factory=list)


def build_turns(segments: Iterable[Segment], speakers: Iterable[NoteSpeaker]) -> list[Turn]:
    """buildTurns of the editor. speakers: the speakers of the base (or at least
    of these segments); one without a name, or not among them, is unknown."""
    segments = list(segments)
    known = {speaker.id: speaker for speaker in speakers if speaker.name}
    unknown = unknown_speaker_names(segments, set(known))

    def describe(spk_id: str) -> TurnSpeaker:
        if spk_id == UNASSIGNED:
            return TurnSpeaker(spk_id, "unassigned", "Unassigned")
        found = known.get(spk_id)
        if found:
            return TurnSpeaker(spk_id, "named", found.name, found.handle)
        return TurnSpeaker(spk_id, "unknown", unknown[spk_id])

    turns: list[Turn] = []
    for segment in segments:
        spk_id = effective_speaker(segment)
        if turns and turns[-1].speaker.id == spk_id:
            turns[-1].segments.append(segment)
        else:
            turns.append(Turn(describe(spk_id), segment.start, [segment]))
    return turns


def clock(seconds: float) -> str:
    """A time in a recording, as formatClock in the UI: mm:ss under an hour,
    h:mm:ss from an hour on, whole seconds rounded down."""
    total = max(0, int(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def turn_block(turn: Turn, diarized: bool = True) -> str:
    """One turn as Copy transcript writes it: its speaker and start time over a
    line per paragraph; without speakers, the paragraphs alone."""
    head = [f"{turn.speaker.name} {clock(turn.start)}"] if diarized else []
    return "\n".join(head + [segment.text for segment in turn.segments])


def transcript_text(title: str, turns: Iterable[Turn], diarized: bool = True) -> str:
    """transcriptText of the editor: the title, then each turn, all apart by an
    empty line."""
    return "\n\n".join([title, *(turn_block(turn, diarized) for turn in turns)])


def note_speakers(storage, memory, recording_id: int) -> NoteSpeakers:
    """Who the note of a recording can mention: every speaker of the base, and
    this recording's speakers without a name by their label."""
    speakers = [
        NoteSpeaker(id=spk_id, name=memory.get_name(spk_id), handle=memory.get_handle(spk_id))
        for spk_id in sorted(memory.speaker_ids())
    ]
    named = {speaker.id for speaker in speakers if speaker.name}
    segments = storage.load(recording_id, with_embeddings=False).segments
    return NoteSpeakers(speakers=speakers, unnamed=unknown_speaker_names(segments, named))
