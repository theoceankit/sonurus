"""The transcript as text (app/services/transcript_text.py): turns and the text
of Copy transcript, as the editor builds them (buildTurns and transcriptText in
ui/src/screens/Editor/transcript.ts). The fixtures in tests/fixtures/transcript
are checked by the UI too (transcript-fixtures.test.ts), which is the reference."""
import json
from pathlib import Path

import pytest

from app.models.segment import UNASSIGNED, Segment
from app.services.note_markdown import NoteSpeaker
from app.services.transcript_text import TurnSpeaker, build_turns, transcript_text, turn_block

FIXTURES = Path(__file__).parent / "fixtures" / "transcript"
CASES = sorted(path.stem for path in FIXTURES.glob("*.json"))


def _load(name):
    data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    segments = [Segment(s["start"], s["end"], s["text"], s["speaker_raw"], speaker_resolved=s["speaker_resolved"],
                        speaker_final=s["speaker_final"], unassigned=s["unassigned"]) for s in data["segments"]]
    speakers = [NoteSpeaker(id=s["id"], name=s["name"], handle=s["handle"]) for s in data["speakers"]]
    return data, segments, speakers


def test_there_are_fixtures():
    assert len(CASES) > 5


@pytest.mark.parametrize("name", CASES)
def test_the_text_is_the_editors(name):
    data, segments, speakers = _load(name)
    expected = (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")
    assert transcript_text(data["title"], build_turns(segments, speakers), data["diarized"]) + "\n" == expected


def _seg(start, speaker, text="x", unassigned=False):
    return Segment(start, start + 1, text, "SPEAKER_00", speaker_resolved=speaker, unassigned=unassigned)


SPEAKERS = [NoteSpeaker("anna", "Anna", "anna"), NoteSpeaker("nameless", None, None)]


def test_a_turn_holds_neighbouring_segments_of_one_speaker():
    turns = build_turns([_seg(0, "anna"), _seg(100, "anna"), _seg(101, "gone"), _seg(102, "anna")], SPEAKERS)
    assert [(t.speaker.id, t.start, len(t.segments)) for t in turns] == [("anna", 0, 2), ("gone", 101, 1), ("anna", 102, 1)]


def test_turn_speakers_are_named_unknown_or_unassigned():
    turns = build_turns([_seg(0, "anna"), _seg(1, "nameless"), _seg(2, "gone"), _seg(3, "x", unassigned=True)], SPEAKERS)
    assert [t.speaker for t in turns] == [
        TurnSpeaker("anna", "named", "Anna", "anna"),
        TurnSpeaker("nameless", "unknown", "Unknown speaker 1"),
        TurnSpeaker("gone", "unknown", "Unknown speaker 2"),
        TurnSpeaker(UNASSIGNED, "unassigned", "Unassigned"),
    ]


def test_a_turn_block_is_its_speaker_and_time_over_its_paragraphs():
    turn = build_turns([_seg(75.9, "anna", "One."), _seg(80, "anna", "Two.")], SPEAKERS)[0]
    assert turn_block(turn, diarized=True) == "Anna 01:15\nOne.\nTwo."
    assert turn_block(turn, diarized=False) == "One.\nTwo."
