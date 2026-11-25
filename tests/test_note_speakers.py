"""Who a note of a recording can mention (app/services/transcript_text.py):
named speakers of the base by handle, and the speakers of this recording
without a name by the label the editor shows (unknownSpeakerNames in
ui/src/screens/Editor/transcript.ts)."""
from app.models.segment import UNASSIGNED, Segment
from app.models.transcript import Transcript
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import TranscriptStorageService
from app.services.transcript_text import effective_speaker, note_speakers, unknown_speaker_names


def _seg(raw, resolved=None, final=None, unassigned=False, start=0.0):
    return Segment(start, start + 1, "x", raw, speaker_resolved=resolved, speaker_final=final, unassigned=unassigned)


def test_effective_speaker_is_the_users_choice_then_the_match_then_diarization():
    assert effective_speaker(_seg("SPEAKER_00")) == "SPEAKER_00"
    assert effective_speaker(_seg("SPEAKER_00", resolved="a")) == "a"
    assert effective_speaker(_seg("SPEAKER_00", resolved="a", final="b")) == "b"
    assert effective_speaker(_seg("SPEAKER_00", final="b", unassigned=True)) == UNASSIGNED


def test_unnamed_speakers_are_numbered_in_the_order_they_first_speak():
    segments = [
        _seg("SPEAKER_01"), _seg("SPEAKER_00", resolved="anna"), _seg("SPEAKER_02"),
        _seg("SPEAKER_01"), _seg("SPEAKER_03", unassigned=True), _seg("SPEAKER_04", resolved="nameless"),
    ]
    assert unknown_speaker_names(segments, {"anna"}) == {
        "SPEAKER_01": "Unknown speaker 1",
        "SPEAKER_02": "Unknown speaker 2",
        "nameless": "Unknown speaker 3",
    }


def test_note_speakers_of_a_recording(tmp_path):
    db = str(tmp_path / "data.db")
    storage = TranscriptStorageService(db_path=db)
    memory = SpeakerMemoryService(db_path=db)
    anna = memory.create_named_speaker("Anna Petrova", handle="anna")
    mark = memory.create_named_speaker("Mark Ellis", handle="mark")
    db_id = storage.save(Transcript(audio_path="recordings/a.wav", language="en", segments=[
        _seg("SPEAKER_00", resolved=anna, start=0), _seg("SPEAKER_01", start=1),
    ]))

    speakers = note_speakers(storage, memory, db_id)

    assert {(s.id, s.name, s.handle) for s in speakers.speakers} == {
        (anna, "Anna Petrova", "anna"), (mark, "Mark Ellis", "mark"),
    }
    assert dict(speakers.unnamed) == {"SPEAKER_01": "Unknown speaker 1"}
