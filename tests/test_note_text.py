"""The text of a note as search sees it: one block per paragraph, heading or
list item, chips written as the editor shows them."""

from app.services.note_text import note_blocks

ANNA = "4f9c0c1e-2a1b-4c7e-9f00-6d1a2b3c4d5e"


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, **extra):
    return {"type": "text", "text": text, **extra}


def test_every_paragraph_and_heading_is_a_block():
    doc = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 1}, "content": [_t("Weekly sync")]},
        _p(_t("First "), _t("bold", marks=[{"type": "bold"}]), _t(" line")),
        _p(),
        _p(_t("Second")),
    ]}
    assert note_blocks(doc) == ["Weekly sync", "First bold line", "Second"]


def test_list_items_and_nested_lists_are_blocks_of_their_own():
    doc = {"type": "doc", "content": [
        {"type": "bulletList", "content": [
            {"type": "listItem", "content": [
                _p(_t("Budget")),
                {"type": "orderedList", "content": [
                    {"type": "listItem", "content": [_p(_t("Q1"))]},
                    {"type": "listItem", "content": [_p(_t("Q2"))]},
                ]},
            ]},
        ]},
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [_p(_t("Send the plan"))]},
        ]},
        {"type": "blockquote", "content": [_p(_t("A quote")), _p(_t("in two lines"))]},
    ]}
    assert note_blocks(doc) == ["Budget", "Q1", "Q2", "Send the plan", "A quote", "in two lines"]


def test_a_speaker_mention_reads_as_the_speakers_name_now():
    doc = {"type": "doc", "content": [_p(
        {"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "Anna"}},
        _t(" talked about money"),
    )]}
    assert note_blocks(doc, {ANNA: "Анна Петрова"}.get) == ["Анна Петрова talked about money"]


def test_a_mention_of_a_speaker_without_a_name_reads_as_its_label():
    doc = {"type": "doc", "content": [_p(
        {"type": "mention", "attrs": {"kind": "speaker", "id": ANNA, "label": "Anna"}},
    )]}
    assert note_blocks(doc) == ["Anna"]
    assert note_blocks(doc, {}.get) == ["Anna"]


def test_a_person_mention_reads_as_its_label():
    doc = {"type": "doc", "content": [_p(
        {"type": "mention", "attrs": {"kind": "person", "id": None, "label": "Mark"}},
        _t(" will call"),
    )]}
    assert note_blocks(doc, {ANNA: "Anna"}.get) == ["Mark will call"]


def test_a_timecode_reads_as_the_chip_shows_it():
    doc = {"type": "doc", "content": [_p(
        {"type": "timecode", "attrs": {"seconds": 754.6}}, _t(" and "),
        {"type": "timecode", "attrs": {"seconds": 3725}}, _t(" and "),
        {"type": "timecode", "attrs": {"seconds": 5}},
    )]}
    assert note_blocks(doc) == ["[12:34] and [1:02:05] and [00:05]"]


def test_a_hard_break_is_a_space_and_links_keep_their_text():
    doc = {"type": "doc", "content": [_p(
        _t("one"), {"type": "hardBreak"}, _t("two ", marks=[{"type": "link", "attrs": {"href": "https://x.y"}}]),
    )]}
    assert note_blocks(doc) == ["one two"]


def test_an_empty_or_odd_document_has_no_blocks():
    assert note_blocks({"type": "doc", "content": []}) == []
    assert note_blocks({"type": "doc"}) == []
    assert note_blocks({}) == []
