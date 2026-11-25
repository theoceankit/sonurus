"""What the MCP read tools answer (app/mcp/read_format.py, app/mcp/tools.py):
pure functions over rows and turns, without MCP or a database."""
import pytest

from app.mcp.read_format import (
    chunks, format_recordings, format_search, format_speakers, read_range, transcript_header, whole_or_contents,
)
from app.mcp.tools import MAX_CHARS, Refused, clock, fit, parse_clock
from app.models.segment import Segment
from app.services.note_markdown import NoteSpeaker
from app.services.transcript_text import build_turns

SPEAKERS = [NoteSpeaker("anna", "Anna Petrova", "anna"), NoteSpeaker("ivan", "Ivan Sidorov", "ivan")]
META = {"id": 42, "title": "Weekly sync", "created_at": "2026-11-20T14:05:31.123", "duration_sec": 3733.4}


def _seg(start, speaker, text=None, length=20):
    return Segment(start, start + length, text or f"Said at {clock(start)}.", "SPEAKER_00", speaker_resolved=speaker)


def _turns(segments):
    return build_turns(segments, SPEAKERS)


def _dialogue(minutes, every=30, words=8):
    """Anna and Ivan in turns of one segment, every `every` seconds."""
    return [_seg(t, "anna" if i % 2 == 0 else "ivan", " ".join(["word"] * words))
            for i, t in enumerate(range(0, minutes * 60, every))]


# ── Times ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value, seconds", [
    ("01:15", 75), ("1:15", 75), ("00:00", 0), ("1:02:13", 3733), ("75", 75), ("75.5", 75.5), (90, 90), (12.5, 12.5),
    (" 05:02 ", 302),
])
def test_a_time_is_mm_ss_h_mm_ss_or_seconds(value, seconds):
    assert parse_clock(value) == seconds


@pytest.mark.parametrize("value", ["", "abc", "1:2:3:4", "05:75", "-5", -1, "1:-5", "1h"])
def test_a_wrong_time_is_refused_in_one_line(value):
    with pytest.raises(Refused) as refusal:
        parse_clock(value)
    message = str(refusal.value)
    assert "\n" not in message
    assert "mm:ss" in message and "seconds" in message


# ── Limit ─────────────────────────────────────────────────────────────────────

def test_fit_keeps_a_short_answer_as_it_is():
    assert fit("a\nb") == "a\nb"


def test_fit_cuts_a_long_answer_by_lines_and_says_so():
    text = "\n".join(f"line {i:05d}" for i in range(10_000))
    cut = fit(text, limit=1000)
    assert len(cut) <= 1000
    assert cut.startswith("line 00000\nline 00001")
    assert cut.splitlines()[-1].endswith("lines not shown.")
    assert len(fit(text)) <= MAX_CHARS


# ── Recordings and speakers ───────────────────────────────────────────────────

def _row(id, title="Weekly sync", created_at="2026-11-20T14:05:00", duration=3733, handles=(), unknown=0, note=False):
    return {"id": id, "title": title, "created_at": created_at, "duration_sec": duration,
            "handles": list(handles), "unknown": unknown, "has_note": note}


def test_a_recording_line_has_its_id_date_length_speakers_and_note():
    rows = [_row(42, handles=["anna", "ivan"], unknown=2, note=True), _row(7, "Interview", "2026-11-02T09:00:00", 75, unknown=1),
            _row(3, "Plain", "2026-10-01T09:00:00", 12)]
    assert format_recordings(rows, total=3, offset=0, filtered=False) == (
        "3 recordings, newest first:\n"
        "- recording_id 42: Weekly sync, 2026-11-20, 1:02:13, @anna @ivan, 2 unknown speakers, has note\n"
        "- recording_id 7: Interview, 2026-11-02, 01:15, 1 unknown speaker\n"
        "- recording_id 3: Plain, 2026-10-01, 00:12"
    )


def test_a_page_of_recordings_says_how_to_read_on():
    text = format_recordings([_row(i) for i in range(50, 100)], total=340, offset=50, filtered=False)
    assert text.splitlines()[0] == "340 recordings, newest first; 51–100 shown:"
    assert text.splitlines()[-1] == "More: call list_recordings with offset=100."


def test_no_recordings_and_no_matches_are_told_apart():
    assert format_recordings([], total=0, offset=0, filtered=False) == (
        "No recordings yet. Transcribe or record audio in Sonorus first."
    )
    assert format_recordings([], total=0, offset=0, filtered=True) == (
        "No recordings match: widen the dates or leave out the speaker."
    )
    assert format_recordings([], total=3, offset=10, filtered=False) == (
        "No recordings from offset 10: there are 3; call list_recordings with offset=0."
    )
    assert format_recordings([_row(1)], total=1, offset=0, filtered=True).startswith("1 recording matches, newest first:")


def test_speakers_are_listed_by_handle_with_their_recordings_and_talk_time():
    rows = [
        {"name": "Anna Petrova", "handle": "anna", "recordings": 14, "duration_sec": 11560.4, "last_seen": "2026-11-20T10:00:00"},
        {"name": "Ivan", "handle": "ivan", "recordings": 1, "duration_sec": 75, "last_seen": "2026-11-02T09:00:00"},
        {"name": "Nobody yet", "handle": "nobody", "recordings": 0, "duration_sec": 0, "last_seen": ""},
    ]
    assert format_speakers(rows, unnamed=12) == (
        "3 speakers with a name:\n"
        "- Anna Petrova @anna: 14 recordings, 3:12:40 talk time, last 2026-11-20\n"
        "- Ivan @ivan: 1 recording, 01:15 talk time, last 2026-11-02\n"
        "- Nobody yet @nobody: no recordings yet\n"
        "12 voices without a name are not listed: they have a label of their own in each recording "
        "(Unknown speaker N), and recordings cannot be filtered by them."
    )


def test_no_named_speakers_says_how_to_get_one():
    assert format_speakers([], unnamed=0) == "No speaker has a name yet. Name speakers in Sonorus to find recordings by them."
    assert format_speakers([], unnamed=1).startswith("No speaker has a name yet.")
    assert "1 voice without a name is not listed" in format_speakers([], unnamed=1)


# ── Transcript ────────────────────────────────────────────────────────────────

def test_the_header_names_the_recording_and_its_speakers_in_order_of_speaking():
    turns = _turns([_seg(0, "ivan"), _seg(5, "x"), _seg(9, "anna"), _seg(12, "ivan"),
                    Segment(14, 15, "lost", "SPEAKER_00", unassigned=True)])
    assert transcript_header(META, turns, diarized=True) == (
        "Weekly sync\n"
        "recording_id 42, 2026-11-20 14:05, 1:02:13\n"
        "Speakers: Ivan Sidorov @ivan, Unknown speaker 1, Anna Petrova @anna"
    )


def test_a_recording_without_speakers_has_no_speakers_line():
    assert transcript_header(META, _turns([_seg(0, None)]), diarized=False) == (
        "Weekly sync\nrecording_id 42, 2026-11-20 14:05, 1:02:13"
    )


def test_a_short_recording_comes_whole_as_copy_transcript_under_the_header():
    turns = _turns([_seg(0, "anna", "Hello."), _seg(3, "anna", "Again."), _seg(75.9, "ivan", "Hi.")])
    assert whole_or_contents(META, turns, diarized=True) == (
        "Weekly sync\n"
        "recording_id 42, 2026-11-20 14:05, 1:02:13\n"
        "Speakers: Anna Petrova @anna, Ivan Sidorov @ivan\n\n"
        "Anna Petrova 00:00\nHello.\nAgain.\n\n"
        "Ivan Sidorov 01:15\nHi."
    )


def test_a_chunk_ends_at_the_first_turn_that_starts_five_minutes_after_it():
    turns = _turns(_dialogue(16))
    parts = chunks(turns)
    starts = [part[0].start for part in parts]
    assert starts == [0, 300, 600, 900]
    # Each chunk is whole turns.
    assert sum(len(part) for part in parts) == len(turns)


def test_a_chunk_waits_for_the_turn_to_end():
    # Anna speaks from 4:50 to 6:10: the chunk takes all of it.
    segments = [_seg(0, "ivan", length=290), _seg(290, "anna", length=40), _seg(330, "anna", length=40),
                _seg(370, "ivan"), _seg(600, "anna")]
    parts = chunks(_turns(segments))
    assert [part[0].start for part in parts] == [0, 370]


def test_a_monologue_over_seven_and_a_half_minutes_is_cut_by_its_segments():
    segments = [_seg(t, "anna", length=30) for t in range(0, 20 * 60, 30)]   # 20 minutes of Anna
    parts = chunks(_turns(segments))
    assert [part[0].start for part in parts] == [0, 300, 600, 900]
    assert all(len(part) == 1 and part[0].speaker.id == "anna" for part in parts)


def test_a_monologue_under_seven_and_a_half_minutes_stays_whole():
    segments = [_seg(t, "anna", length=30) for t in range(0, 7 * 60, 30)] + [_seg(420, "ivan")]
    parts = chunks(_turns(segments))
    assert [part[0].start for part in parts] == [0, 420]


def test_a_long_recording_comes_as_contents_with_a_hint():
    turns = _turns(_dialogue(90, words=60))
    text = whole_or_contents(META, turns, diarized=True)
    assert len(text) <= MAX_CHARS
    lines = text.splitlines()
    assert lines[:3] == ["Weekly sync", "recording_id 42, 2026-11-20 14:05, 1:02:13",
                         "Speakers: Anna Petrova @anna, Ivan Sidorov @ivan"]
    hint = lines[4]
    assert hint.startswith("Too long to return whole (")
    assert hint.endswith('Read a part with get_transcript(recording_id=42, start="00:00", end="05:00").')
    assert lines[6] == "Contents, in parts of about 5 minutes:"
    toc = [line for line in lines if line.startswith("- ")]
    assert len(toc) == 18
    assert toc[0].startswith('- 00:00–04:50, Anna Petrova, Ivan Sidorov (')
    assert toc[0].endswith('chars): "word word word word word word word word word word word word word word word word word word word word…"')
    assert toc[-1].startswith("- 1:25:00–1:29:50, ")


def test_the_contents_count_the_characters_of_each_part():
    turns = _turns(_dialogue(90, words=60))
    text = whole_or_contents(META, turns, diarized=True)
    first = next(line for line in text.splitlines() if line.startswith("- "))
    part = read_range(META, turns, diarized=True, start=0, end=300)
    body = part.split("\n\n", 1)[1]
    assert f"({len(body):,} chars)" in first


def test_contents_of_a_recording_without_speakers_name_nobody():
    segments = [_seg(t, None, " ".join(["word"] * 60)) for t in range(0, 90 * 60, 30)]
    text = whole_or_contents(META, _turns(segments), diarized=False)
    toc = [line for line in text.splitlines() if line.startswith("- ")]
    assert toc[0].startswith("- 00:00–04:50 (")
    assert "Speakers:" not in text


def test_a_range_reads_the_segments_that_start_in_it_and_repeats_the_speaker():
    segments = [_seg(0, "anna", "One.", 10), _seg(10, "anna", "Two.", 10), _seg(20, "anna", "Three.", 10),
                _seg(30, "ivan", "Four.", 10)]
    assert read_range(META, _turns(segments), diarized=True, start=10, end=30) == (
        "Weekly sync\n"
        "recording_id 42, 2026-11-20 14:05, 1:02:13\n"
        "Speakers: Anna Petrova @anna, Ivan Sidorov @ivan\n"
        "Part 00:10–00:30\n\n"
        "Anna Petrova 00:10\nTwo.\nThree."
    )


def test_a_range_without_an_end_reads_to_the_end_and_without_a_start_from_the_start():
    segments = [_seg(0, "anna", "One."), _seg(30, "ivan", "Two.")]
    assert read_range(META, _turns(segments), diarized=True, start=20, end=None).endswith("Ivan Sidorov 00:30\nTwo.")
    assert read_range(META, _turns(segments), diarized=True, start=None, end=20).endswith("Anna Petrova 00:00\nOne.")


def test_a_range_counts_whole_seconds_so_nothing_falls_between_two_parts():
    segments = [_seg(302.4, "anna", "Before."), _seg(302.7, "ivan", "After.")]
    text = read_range(META, _turns(segments), diarized=True, start=parse_clock("05:02"), end=None)
    assert "Before." in text and "After." in text


def test_a_range_too_long_is_cut_at_a_turn_with_a_hint():
    turns = _turns(_dialogue(90, words=60))
    text = read_range(META, turns, diarized=True, start=0, end=None)
    assert len(text) <= MAX_CHARS
    last = text.splitlines()[-1]
    assert last.startswith("Cut at ") and last.endswith(" to read on.")
    resume = last.split("start=")[1].removesuffix(" to read on.")
    assert last == f"Cut at {resume}: call get_transcript with start={resume} to read on."
    # The turn the cut names is not in the text; the one before it is.
    assert f"{clock(parse_clock(resume))}\n" not in text.split("\n\n", 1)[1]


def test_one_turn_too_long_is_cut_between_its_segments():
    segments = [_seg(t, "anna", " ".join(["word"] * 200), length=30) for t in range(0, 2 * 3600, 30)]
    text = read_range(META, _turns(segments), diarized=True, start=0, end=None)
    assert len(text) <= MAX_CHARS
    assert text.splitlines()[-1].startswith("Cut at ")
    assert text.count("Anna Petrova 00:00") == 1


def test_a_range_with_no_speech_says_so():
    segments = [_seg(0, "anna"), _seg(600, "ivan")]
    assert read_range(META, _turns(segments), diarized=True, start=100, end=200).endswith(
        "No speech starts between 01:40 and 03:20."
    )


def test_wrong_ranges_are_refused_in_one_line():
    turns = _turns([_seg(0, "anna")])
    with pytest.raises(Refused, match=r"^The end 05:00 is not after the start 10:00: give an end after the start\.$"):
        read_range(META, turns, diarized=True, start=600, end=300)
    with pytest.raises(Refused, match=r"^Recording 42 is 1:02:13 long: give a start before 1:02:13\.$"):
        read_range(META, turns, diarized=True, start=4000, end=None)


# ── Search ────────────────────────────────────────────────────────────────────

def _hit(kind, snippet, highlights, start=None, speaker_id=None, name=None, handle=None, unassigned=False):
    return {"kind": kind, "snippet": snippet, "highlights": highlights, "start": start, "end": None,
            "speaker_id": speaker_id, "speaker_name": name, "speaker_handle": handle, "unassigned": unassigned}


def test_search_hits_are_grouped_by_recording_with_matches_in_bold():
    result = {
        "total_hits": 7, "total_recordings": 2,
        "recordings": [
            {"recording_id": 42, "title": "Weekly sync", "created_at": "2026-11-20T14:05:00", "duration_sec": 3733,
             "hit_count": 5, "hits": [
                 _hit("title", "Release planning", [[0, 7]]),
                 _hit("segment", "we moved the release to Friday", [[13, 20]], 754.2, "anna", "Anna Petrova", "anna"),
                 _hit("segment", "release it\nnow", [[0, 7]], 800, "u1"),
             ]},
            {"recording_id": 7, "title": "Interview", "created_at": "2026-11-02T09:00:00", "duration_sec": 75,
             "hit_count": 2, "hits": [
                 _hit("note", "…the release checklist", [[5, 12]]),
                 _hit("segment", "released", [[0, 8]], 3725, None, unassigned=True),
             ]},
        ],
        "speakers": [{"id": "anna", "name": "Anna Petrova", "handle": "anna"}],
    }
    labels = {42: {"u1": "Unknown speaker 2"}}
    assert format_search(result, labels, recording_id=None, offset=0, limit=10) == (
        "7 hits in 2 recordings, newest first:\n\n"
        "recording_id 42: Weekly sync, 2026-11-20 (5 hits)\n"
        "  title: **Release** planning\n"
        "  12:34 Anna Petrova @anna: we moved the **release** to Friday\n"
        "  13:20 Unknown speaker 2: **release** it now\n"
        "  2 more: call search with recording_id=42.\n\n"
        "recording_id 7: Interview, 2026-11-02 (2 hits)\n"
        "  note: …the **release** checklist\n"
        "  1:02:05 Unassigned: **released**\n\n"
        "Speakers whose name or handle matches: Anna Petrova @anna. To search what one said, give speaker=\"@anna\"."
    )


def test_search_says_how_to_read_more_recordings_and_more_hits_of_one():
    recording = {"recording_id": 42, "title": "Weekly sync", "created_at": "2026-11-20T14:05:00", "duration_sec": 3733,
                 "hit_count": 30, "hits": [_hit("segment", "x", [[0, 1]], 1, "anna", "Anna", "anna")] * 20}
    page = format_search({"total_hits": 300, "total_recordings": 25, "recordings": [recording] * 10, "speakers": []},
                         {}, recording_id=None, offset=10, limit=10)
    assert page.splitlines()[0] == "300 hits in 25 recordings, newest first; recordings 11–20 shown:"
    assert page.splitlines()[-1] == "More recordings: call search with offset=20."
    one = format_search({"total_hits": 30, "total_recordings": 1, "recordings": [recording], "speakers": []},
                        {}, recording_id=42, offset=0, limit=10)
    assert one.splitlines()[0] == "30 hits in recording 42; 1–20 shown:"
    assert one.splitlines()[-1] == "More hits: call search with recording_id=42 and offset=20."
    assert "more: call search" not in one


def test_search_without_hits_says_so():
    empty = {"total_hits": 0, "total_recordings": 0, "recordings": [], "speakers": []}
    assert format_search(empty, {}, recording_id=None, offset=0, limit=10) == (
        "No hits. Try other words, a word's beginning, or OR between words."
    )
