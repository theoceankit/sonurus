"""
Tests for TranscriptBuilder — both build() and attach_embeddings().

Sections:
  - build(): constructs a Transcript from raw WhisperX output + speaker map
  - attach_embeddings(): assigns per-segment embeddings by time overlap
"""

import numpy as np
import pytest
from app.models.segment import Segment
from app.models.transcript import Transcript
from app.services.transcript_builder import TranscriptBuilder


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_transcript(*segments):
    return Transcript(segments=list(segments), audio_path="test.wav", language="en")


def make_seg(start, end, text="...", raw="SPEAKER_00"):
    return Segment(start=start, end=end, text=text, speaker_raw=raw)


def make_emb(start, end, speaker="SPEAKER_00"):
    """Embedding entry as returned by EmbeddingService.extract_segments()."""
    return {"start": start, "end": end, "speaker": speaker, "embedding": np.array([start, end, 0.0])}


def make_result(*segments, language="en"):
    """Minimal WhisperX-style result dict."""
    return {
        "language": language,
        "segments": [
            {
                "start": s["start"],
                "end":   s["end"],
                "text":  s["text"],
                **( {"speaker": s["speaker"]} if "speaker" in s else {} ),
            }
            for s in segments
        ],
    }


def seg(start, end, text, speaker=None):
    d = {"start": start, "end": end, "text": text}
    if speaker is not None:
        d["speaker"] = speaker
    return d


# ---------------------------------------------------------------------------
# build()
# ---------------------------------------------------------------------------

def test_build_creates_correct_segment_count():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"),
                         seg(2.0, 4.0, "Bye", "SPEAKER_01"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert len(transcript.segments) == 2


def test_build_sets_timestamps_and_text():
    result = make_result(seg(1.5, 3.0, "Hello world", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    s = transcript.segments[0]
    assert s.start == 1.5
    assert s.end == 3.0
    assert s.text == "Hello world"


def test_build_strips_whitespace_from_text():
    result = make_result(seg(0.0, 1.0, "  padded  ", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].text == "padded"


def test_build_sets_audio_path_and_language():
    result = make_result(seg(0.0, 1.0, "Hi", "SPEAKER_00"), language="ru")
    transcript = TranscriptBuilder.build(result, {}, "files/meeting.wav")
    assert transcript.audio_path == "files/meeting.wav"
    assert transcript.language == "ru"


def test_build_status_is_draft():
    result = make_result(seg(0.0, 1.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.status == "draft"


def test_build_speaker_final_starts_as_none():
    result = make_result(seg(0.0, 1.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_final is None


def test_build_sets_speaker_raw():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_raw == "SPEAKER_00"


def test_build_applies_speaker_map():
    result = make_result(seg(0.0, 2.0, "Hi", "SPEAKER_00"))
    transcript = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav")
    assert transcript.segments[0].speaker_resolved == "Alice"


def test_build_unmatched_diarization_speaker_gets_its_own_uuid():
    """A SPEAKER_XX without a voice profile match (e.g. too little speech for an
    embedding) still gets a stable UUID — raw labels are never persisted."""
    import uuid
    result = make_result(
        seg(0.0, 1.0, "a", "SPEAKER_98"), seg(1.0, 2.0, "b", "SPEAKER_99"), seg(2.0, 3.0, "c", "SPEAKER_98"),
    )
    segs = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav").segments
    ids = [s.speaker_resolved for s in segs]
    assert uuid.UUID(ids[0]).version == 4 and uuid.UUID(ids[1]).version == 4
    assert ids[0] == ids[2] and ids[0] != ids[1]
    assert not any(s.unassigned for s in segs)
    assert [s.speaker_raw for s in segs] == ["SPEAKER_98", "SPEAKER_99", "SPEAKER_98"]


def test_build_segment_without_diarization_speaker_is_unassigned():
    result = make_result(seg(0.0, 1.0, "Hi"), seg(1.0, 2.0, "Yo", "SPEAKER_00"))
    segs = TranscriptBuilder.build(result, {"SPEAKER_00": "Alice"}, "audio.wav").segments
    assert segs[0].unassigned is True and segs[0].speaker_resolved is None
    assert segs[1].unassigned is False and segs[1].speaker_resolved == "Alice"


def test_build_missing_speaker_field_defaults_to_unknown():
    """Segment without a 'speaker' key gets speaker_raw='UNKNOWN'."""
    result = make_result(seg(0.0, 1.0, "Hi"))  # no speaker key
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments[0].speaker_raw == "UNKNOWN"


def test_build_multiple_speakers_all_resolved():
    result = make_result(
        seg(0.0, 2.0, "Hi",  "SPEAKER_00"),
        seg(2.0, 4.0, "Bye", "SPEAKER_01"),
    )
    speaker_map = {"SPEAKER_00": "Alice", "SPEAKER_01": "Bob"}
    transcript = TranscriptBuilder.build(result, speaker_map, "audio.wav")
    assert transcript.segments[0].speaker_resolved == "Alice"
    assert transcript.segments[1].speaker_resolved == "Bob"


def test_build_empty_segments():
    result = {"language": "en", "segments": []}
    transcript = TranscriptBuilder.build(result, {}, "audio.wav")
    assert transcript.segments == []
    assert transcript.language == "en"


# ---------------------------------------------------------------------------
# attach_embeddings()
# ---------------------------------------------------------------------------

def test_exact_match_gets_correct_embedding():
    """A segment with exactly matching timestamps gets the correct embedding."""
    seg_ = make_seg(0.0, 2.0)
    emb = make_emb(0.0, 2.0)

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [emb])

    assert transcript.segments[0].embedding is not None
    assert np.allclose(transcript.segments[0].embedding, emb["embedding"])


def test_close_segment_gets_nearby_embedding():
    """A slightly time-shifted segment (<0.5s) still gets the nearest embedding."""
    seg_ = make_seg(0.1, 2.1)
    emb = make_emb(0.0, 2.0)

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [emb])

    assert transcript.segments[0].embedding is not None
    assert np.allclose(transcript.segments[0].embedding, emb["embedding"])


def test_multiple_segments_each_gets_own_embedding():
    """Each of multiple segments gets its own nearest embedding."""
    seg0 = make_seg(0.0, 2.0)
    seg1 = make_seg(5.0, 7.0)
    emb0 = make_emb(0.0, 2.0)
    emb1 = make_emb(5.0, 7.0)

    transcript = make_transcript(seg0, seg1)
    TranscriptBuilder.attach_embeddings(transcript, [emb0, emb1])

    assert np.allclose(transcript.segments[0].embedding, emb0["embedding"])
    assert np.allclose(transcript.segments[1].embedding, emb1["embedding"])


def test_distant_segment_gets_no_embedding():
    """
    A short segment filtered by extract_segments() has no embedding entry.
    The only available embedding is far away — segment must stay None.
    """
    short_seg = make_seg(10.0, 10.3)
    far_emb = make_emb(0.0, 2.0)

    transcript = make_transcript(short_seg)
    TranscriptBuilder.attach_embeddings(transcript, [far_emb])

    assert transcript.segments[0].embedding is None, (
        "A segment with no overlapping embedding must remain None, "
        "not receive a distant unrelated embedding"
    )


def test_segment_with_no_embeddings_at_all_stays_none():
    """When segment_embeddings is empty, all segments must remain without embedding."""
    seg_ = make_seg(0.0, 2.0)

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [])

    assert transcript.segments[0].embedding is None


def test_transcript_segment_inside_diarization_segment_gets_embedding():
    """
    WhisperX produces fine-grained segments [1.2, 2.5] while diarization
    produces a coarser segment [0.0, 10.0]. The transcript segment falls
    inside the diarization segment — it must receive its embedding.
    """
    transcript_seg = make_seg(1.2, 2.5)
    diarization_emb = make_emb(0.0, 10.0)

    transcript = make_transcript(transcript_seg)
    TranscriptBuilder.attach_embeddings(transcript, [diarization_emb])

    assert transcript.segments[0].embedding is not None, (
        "A segment contained within a diarization span must receive its embedding"
    )


# ---------------------------------------------------------------------------
# attach_embeddings(): speaker-aware matching
# A Whisper segment can span a speaker change; the embedding must come from
# the segment's own speaker, or it contaminates that speaker's profile.
# ---------------------------------------------------------------------------

def test_prefers_same_speaker_turn_over_larger_overlap():
    seg_ = make_seg(0.0, 4.0, raw="SPEAKER_00")
    other = make_emb(0.0, 3.0, speaker="SPEAKER_01")   # larger overlap, wrong voice
    own = make_emb(3.0, 4.0, speaker="SPEAKER_00")

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [other, own])

    assert np.allclose(transcript.segments[0].embedding, own["embedding"])


def test_no_embedding_when_only_other_speakers_overlap():
    seg_ = make_seg(0.0, 2.0, raw="SPEAKER_00")
    other = make_emb(0.0, 2.0, speaker="SPEAKER_01")

    transcript = make_transcript(seg_)
    TranscriptBuilder.attach_embeddings(transcript, [other])

    assert transcript.segments[0].embedding is None


# ---------------------------------------------------------------------------
# build(): splitting a segment where the word speaker changes
# ---------------------------------------------------------------------------

def w(word, start=None, end=None, speaker=None):
    """A WhisperX aligned word; time and speaker are absent when not aligned."""
    d = {"word": word}
    if start is not None:
        d["start"] = start
    if end is not None:
        d["end"] = end
    if speaker is not None:
        d["speaker"] = speaker
    return d


def wseg(text, words, speaker="SPEAKER_00", start=None, end=None):
    timed = [x for x in words if "start" in x]
    return {
        "start": timed[0]["start"] if start is None else start,
        "end": timed[-1]["end"] if end is None else end,
        "text": text, "speaker": speaker, "words": words,
    }


def build_one(segment, language="en", speaker_map=None):
    result = {"language": language, "segments": [segment]}
    return TranscriptBuilder.build(result, speaker_map or {}, "audio.wav").segments


def two_speakers():
    return wseg(" So what do you think? I think it is fine.", [
        w("So", 0.0, 0.2, "SPEAKER_00"), w("what", 0.25, 0.5, "SPEAKER_00"),
        w("do", 0.55, 0.7, "SPEAKER_00"), w("you", 0.75, 0.9, "SPEAKER_00"),
        w("think?", 0.95, 1.4, "SPEAKER_00"),
        w("I", 1.6, 1.7, "SPEAKER_01"), w("think", 1.75, 2.0, "SPEAKER_01"),
        w("it", 2.05, 2.2, "SPEAKER_01"), w("is", 2.25, 2.4, "SPEAKER_01"),
        w("fine.", 2.45, 2.9, "SPEAKER_01"),
    ])


def test_split_at_word_speaker_change():
    segs = build_one(two_speakers())
    assert [(s.speaker_raw, s.text) for s in segs] == [
        ("SPEAKER_00", "So what do you think?"),
        ("SPEAKER_01", "I think it is fine."),
    ]


def test_split_pieces_take_times_from_words():
    segs = build_one(two_speakers())
    assert (segs[0].start, segs[0].end) == (0.0, 1.4)
    assert (segs[1].start, segs[1].end) == (1.6, 2.9)


def test_split_first_and_last_piece_keep_segment_bounds():
    segment = two_speakers()
    segment["start"], segment["end"] = -0.1, 3.0
    segs = build_one(segment)
    assert segs[0].start == -0.1
    assert segs[-1].end == 3.0


def test_split_pieces_resolve_their_own_speaker():
    segs = build_one(two_speakers(), speaker_map={"SPEAKER_00": "A", "SPEAKER_01": "B"})
    assert [s.speaker_resolved for s in segs] == ["A", "B"]
    assert not any(s.unassigned for s in segs)


def test_split_pieces_are_plain_floats():
    import numpy as np
    segment = two_speakers()
    for x in segment["words"]:
        x["start"], x["end"] = np.float64(x["start"]), np.float64(x["end"])
    segs = build_one(segment)
    assert all(type(s.start) is float and type(s.end) is float for s in segs)


def test_single_word_of_another_speaker_stays_in_the_segment():
    segment = wseg("We should go now, right?", [
        w("We", 0.0, 0.3, "SPEAKER_00"), w("should", 0.35, 0.7, "SPEAKER_00"),
        w("go", 0.75, 1.0, "SPEAKER_01"),
        w("now,", 1.05, 1.4, "SPEAKER_00"), w("right?", 1.45, 1.9, "SPEAKER_00"),
    ])
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text) for s in segs] == [("SPEAKER_00", "We should go now, right?")]


def test_short_run_in_time_stays_with_neighbours():
    # two words but only 0.3 s long: under the minimum duration
    segment = wseg("Right so we are going to start the meeting now.", [
        w("Right", 0.0, 0.3, "SPEAKER_00"), w("so", 0.35, 0.5, "SPEAKER_00"),
        w("we", 0.55, 0.7, "SPEAKER_01"), w("are", 0.7, 0.85, "SPEAKER_01"),
        w("going", 0.9, 1.1, "SPEAKER_00"), w("to", 1.1, 1.2, "SPEAKER_00"),
        w("start", 1.25, 1.5, "SPEAKER_00"), w("the", 1.5, 1.6, "SPEAKER_00"),
        w("meeting", 1.65, 2.0, "SPEAKER_00"), w("now.", 2.05, 2.3, "SPEAKER_00"),
    ])
    segs = build_one(segment)
    assert len(segs) == 1
    assert segs[0].speaker_raw == "SPEAKER_00"


def test_short_run_between_two_speakers_joins_the_longer_neighbour():
    segment = wseg("Okay that is all from me. Yes. Thanks everyone for coming today.", [
        w("Okay", 0.0, 0.3, "SPEAKER_00"), w("that", 0.35, 0.5, "SPEAKER_00"),
        w("is", 0.55, 0.65, "SPEAKER_00"), w("all", 0.7, 0.9, "SPEAKER_00"),
        w("from", 0.95, 1.1, "SPEAKER_00"), w("me.", 1.15, 1.4, "SPEAKER_00"),
        w("Yes.", 1.5, 1.8, "SPEAKER_02"),
        w("Thanks", 2.0, 2.3, "SPEAKER_01"), w("everyone", 2.35, 2.8, "SPEAKER_01"),
        w("for", 2.85, 3.0, "SPEAKER_01"), w("coming", 3.05, 3.4, "SPEAKER_01"),
        w("today.", 3.45, 3.9, "SPEAKER_01"),
    ])
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text) for s in segs] == [
        ("SPEAKER_00", "Okay that is all from me. Yes."),
        ("SPEAKER_01", "Thanks everyone for coming today."),
    ]


def test_short_first_run_joins_the_next_one():
    segment = wseg("Yeah, so the budget is twelve euros.", [
        w("Yeah,", 0.0, 0.3, "SPEAKER_01"),
        w("so", 0.4, 0.6, "SPEAKER_00"), w("the", 0.65, 0.8, "SPEAKER_00"),
        w("budget", 0.85, 1.2, "SPEAKER_00"), w("is", 1.25, 1.4, "SPEAKER_00"),
        w("twelve", 1.45, 1.8, "SPEAKER_00"), w("euros.", 1.85, 2.3, "SPEAKER_00"),
    ])
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text) for s in segs] == [("SPEAKER_00", "Yeah, so the budget is twelve euros.")]


def test_words_without_speaker_go_with_the_previous_words():
    segment = two_speakers()
    segment["words"][5].pop("speaker")      # "I" in a diarization gap
    segment["words"][4].pop("speaker")      # "think?"
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text) for s in segs] == [
        ("SPEAKER_00", "So what do you think? I"),
        ("SPEAKER_01", "think it is fine."),
    ]


def test_words_without_speaker_at_the_start_go_with_the_next_words():
    segment = two_speakers()
    segment["words"][0].pop("speaker")
    segment["words"][1].pop("speaker")
    segs = build_one(segment)
    assert [s.speaker_raw for s in segs] == ["SPEAKER_00", "SPEAKER_01"]
    assert segs[0].text == "So what do you think?"


def test_words_without_time_stay_in_text_and_order():
    segment = wseg("We paid 25 euros. No, it was 30 euros.", [
        w("We", 0.0, 0.3, "SPEAKER_00"), w("paid", 0.35, 0.7, "SPEAKER_00"),
        w("25"),                                     # not aligned, no time, no speaker
        w("euros.", 1.0, 1.4, "SPEAKER_00"),
        w("No,", 1.6, 1.9, "SPEAKER_01"), w("it", 1.95, 2.1, "SPEAKER_01"),
        w("was", 2.15, 2.3, "SPEAKER_01"), w("30"),
        w("euros.", 2.6, 3.0, "SPEAKER_01"),
    ])
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text, s.start, s.end) for s in segs] == [
        ("SPEAKER_00", "We paid 25 euros.", 0.0, 1.4),
        ("SPEAKER_01", "No, it was 30 euros.", 1.6, 3.0),
    ]


def test_split_in_a_language_without_spaces():
    chars = "今日は晴れですねそうですね"
    words = [w(c, 0.3 * k, 0.3 * k + 0.25, "SPEAKER_00" if k < 8 else "SPEAKER_01")
             for k, c in enumerate(chars)]
    segs = build_one(wseg(chars, words), language="ja")
    assert [(s.speaker_raw, s.text) for s in segs] == [
        ("SPEAKER_00", "今日は晴れですね"),
        ("SPEAKER_01", "そうですね"),
    ]


def test_words_not_found_in_text_are_joined():
    segment = two_speakers()
    segment["text"] = "something else entirely"
    segs = build_one(segment)
    assert [s.text for s in segs] == ["So what do you think?", "I think it is fine."]


def test_words_not_found_in_text_without_spaces_are_joined_without_spaces():
    words = [w(c, 0.3 * k, 0.3 * k + 0.25, "SPEAKER_00" if k < 4 else "SPEAKER_01")
             for k, c in enumerate("今日は晴そうです")]
    segs = build_one(wseg("???", words), language="zh")
    assert [s.text for s in segs] == ["今日は晴", "そうです"]


def test_overlapping_word_times_give_increasing_non_overlapping_pieces():
    segment = two_speakers()
    segment["words"][4]["end"] = 1.8          # "think?" ends after "I" starts
    segs = build_one(segment)
    assert len(segs) == 2
    assert segs[0].end <= segs[1].start
    assert segs[0].start < segs[1].start


def test_pieces_with_the_same_start_are_merged():
    segment = two_speakers()
    for x in segment["words"]:
        x["start"], x["end"] = 1.0, 1.0       # alignment collapsed every word
    segs = build_one(segment, speaker_map={})
    starts = [s.start for s in segs]
    assert len(starts) == len(set(starts))


def test_three_runs_give_three_segments():
    segment = wseg("Do you agree? I do not. Well I do.", [
        w("Do", 0.0, 0.2, "SPEAKER_00"), w("you", 0.25, 0.4, "SPEAKER_00"),
        w("agree?", 0.45, 0.9, "SPEAKER_00"),
        w("I", 1.0, 1.1, "SPEAKER_01"), w("do", 1.15, 1.3, "SPEAKER_01"),
        w("not.", 1.35, 1.7, "SPEAKER_01"),
        w("Well", 1.9, 2.1, "SPEAKER_02"), w("I", 2.15, 2.2, "SPEAKER_02"),
        w("do.", 2.25, 2.6, "SPEAKER_02"),
    ])
    segs = build_one(segment)
    assert [s.speaker_raw for s in segs] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"]
    assert [s.text for s in segs] == ["Do you agree?", "I do not.", "Well I do."]


def test_segment_without_words_is_kept_whole():
    segs = build_one({"start": 0.0, "end": 2.0, "text": " Hello there.", "speaker": "SPEAKER_01"})
    assert [(s.speaker_raw, s.text, s.start, s.end) for s in segs] == [("SPEAKER_01", "Hello there.", 0.0, 2.0)]


def test_segment_with_one_word_speaker_keeps_the_segment_speaker():
    # the segment speaker (largest summed overlap) can differ from its words'
    segment = wseg("Hello there.", [w("Hello", 0.0, 0.4, "SPEAKER_01"), w("there.", 0.5, 0.9, "SPEAKER_01")],
                   speaker="SPEAKER_00", start=0.0, end=2.0)
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text, s.start, s.end) for s in segs] == [("SPEAKER_00", "Hello there.", 0.0, 2.0)]


def test_segment_whose_words_have_no_speaker_is_kept_whole():
    segment = wseg("Hello there.", [w("Hello", 0.0, 0.4), w("there.", 0.5, 0.9)], speaker="SPEAKER_00")
    segs = build_one(segment)
    assert [(s.speaker_raw, s.text) for s in segs] == [("SPEAKER_00", "Hello there.")]


def test_unknown_segment_speaker_is_not_used_for_pieces():
    segment = two_speakers()
    segment.pop("speaker")
    segs = build_one(segment, speaker_map={"SPEAKER_00": "A", "SPEAKER_01": "B"})
    assert [s.speaker_resolved for s in segs] == ["A", "B"]


def test_split_can_be_turned_off(monkeypatch):
    from app.services import transcript_builder
    monkeypatch.setattr(transcript_builder, "SPLIT_AT_WORD_SPEAKERS", False)
    segs = build_one(two_speakers())
    assert [(s.speaker_raw, s.text) for s in segs] == [
        ("SPEAKER_00", "So what do you think? I think it is fine.")]


def test_split_piece_gets_the_embedding_of_its_own_speaker():
    transcript = TranscriptBuilder.build(
        {"language": "en", "segments": [two_speakers()]}, {}, "audio.wav")
    ann = make_emb(0.0, 1.5, "SPEAKER_00")
    bob = make_emb(1.5, 3.0, "SPEAKER_01")
    TranscriptBuilder.attach_embeddings(transcript, [ann, bob])
    first, second = transcript.segments
    assert first.embedding is ann["embedding"]
    assert second.embedding is bob["embedding"]
