"""A recording as the editor shows it, for tools that give it out as text: the
effective speaker of a segment and the labels of speakers without a name.

Ports of ui/src/api/types.ts (effectiveSpeaker) and
ui/src/screens/Editor/transcript.ts (unknownSpeakerNames): an agent reads and
writes the labels the user sees.
"""
from __future__ import annotations

from collections.abc import Iterable, Set

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
