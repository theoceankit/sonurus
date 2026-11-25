"""The note as Markdown and back (app/services/note_markdown.py).

The documents in tests/fixtures/notes are what the note editor saves itself, which
ui/src/components/NoteEditor/note-fixtures.test.tsx proves; here each one goes to
Markdown and back:

- <case>.json + <case>.md: the note and its Markdown, each turns into the other.
- <case>.input.json: a note that becomes <case>.md, its normal form being <case>.json.
- <case>.input.md: Markdown as an agent may write it, which becomes <case>.json
  with the warnings of <case>.warnings.json.
"""
import json
from pathlib import Path

import pytest

from app.services.note_markdown import NoteSpeaker, NoteSpeakers, markdown_to_note, normalize, note_to_markdown

FIXTURES = Path(__file__).parent / "fixtures" / "notes"


def _load_speakers() -> NoteSpeakers:
    data = json.loads((FIXTURES / "speakers.json").read_text())
    return NoteSpeakers(
        speakers=[NoteSpeaker(id=s["id"], name=s["name"], handle=s["handle"]) for s in data["speakers"]],
        unnamed=data["unnamed"],
    )


SPEAKERS = _load_speakers()
ANNA = SPEAKERS.speakers[0].id
UNNAMED = next(iter(SPEAKERS.unnamed))

CASES = sorted(p.name[: -len(".md")] for p in FIXTURES.glob("*.md") if not p.name.endswith(".input.md"))
JSON_INPUTS = sorted(p.name[: -len(".input.json")] for p in FIXTURES.glob("*.input.json"))
MD_INPUTS = sorted(p.name[: -len(".input.md")] for p in FIXTURES.glob("*.input.md"))


def _json(name: str):
    return json.loads((FIXTURES / name).read_text())


def _md(name: str) -> str:
    return (FIXTURES / name).read_text()


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(*content):
    return {"type": "paragraph", **({"content": list(content)} if content else {})}


def _t(text, *marks):
    return {"type": "text", **({"marks": [{"type": m} for m in marks]} if marks else {}), "text": text}


def _mention(id_, label, kind="speaker"):
    return {"type": "mention", "attrs": {"id": id_, "label": label, "mentionSuggestionChar": "@", "kind": kind}}


def test_fixtures_are_there():
    assert len(CASES) >= 10
    assert "minutes" in JSON_INPUTS
    assert MD_INPUTS


@pytest.mark.parametrize("case", CASES)
def test_note_to_markdown(case):
    assert note_to_markdown(_json(f"{case}.json"), SPEAKERS) == _md(f"{case}.md")


@pytest.mark.parametrize("case", CASES)
def test_markdown_to_note(case):
    result = markdown_to_note(_md(f"{case}.md"), SPEAKERS)
    assert result.doc == _json(f"{case}.json")
    assert result.warnings == []


@pytest.mark.parametrize("case", JSON_INPUTS)
def test_note_in_normal_form(case):
    raw = _json(f"{case}.input.json")
    markdown = note_to_markdown(raw, SPEAKERS)
    assert markdown == _md(f"{case}.md")
    assert markdown_to_note(markdown, SPEAKERS).doc == _json(f"{case}.json")


@pytest.mark.parametrize("case", MD_INPUTS)
def test_markdown_of_an_agent(case):
    result = markdown_to_note(_md(f"{case}.input.md"), SPEAKERS)
    assert result.doc == _json(f"{case}.json")
    assert result.warnings == _json(f"{case}.warnings.json")


def test_the_example_keeps_its_chips():
    text = "## Итоги\n\n@anna.petrova договорилась с @[Sam from support] про логи.\n\n> @[Unknown speaker 2] [12:34]\n>\n> Давайте перенесём релиз на пятницу."
    doc = markdown_to_note(text, SPEAKERS).doc
    mentions = [n for b in doc["content"] for n in _inline(b) if n["type"] == "mention"]
    assert [(m["attrs"]["kind"], m["attrs"]["id"], m["attrs"]["label"]) for m in mentions] == [
        ("speaker", ANNA, "Anna Petrova"), ("person", None, "Sam from support"), ("speaker", UNNAMED, "Unknown speaker 2"),
    ]
    assert note_to_markdown(doc, SPEAKERS) == text


def _inline(node):
    for child in node.get("content", []):
        if child["type"] in ("text", "mention", "timecode", "hardBreak"):
            yield child
        else:
            yield from _inline(child)


def test_empty_markdown_is_an_empty_note():
    assert markdown_to_note("", SPEAKERS).doc == _doc(_p())
    assert markdown_to_note("  \n\n", SPEAKERS).doc == _doc(_p())
    assert note_to_markdown(_doc(_p()), SPEAKERS) == ""


def test_a_final_newline_changes_nothing():
    assert markdown_to_note("Text\n", SPEAKERS).doc == _doc(_p(_t("Text")))


def test_at_inside_a_word_is_text():
    result = markdown_to_note("mail anna.petrova@example.com", SPEAKERS)
    assert result.doc == _doc(_p(_t("mail anna.petrova@example.com")))
    assert result.warnings == []


def test_punctuation_after_a_handle_is_not_part_of_it():
    for after in (".", ",", "!", "?", ")", "...", "-"):
        doc = markdown_to_note(f"@anna.petrova{after}", SPEAKERS).doc
        assert doc == _doc(_p(_mention(ANNA, "Anna Petrova"), _t(after))), after


def test_a_handle_is_found_in_any_case():
    assert markdown_to_note("@ANNA.Petrova", SPEAKERS).doc == _doc(_p(_mention(ANNA, "Anna Petrova")))


def test_unknown_handles_are_text_with_one_warning():
    result = markdown_to_note("@petya, @vasya and @petya", SPEAKERS)
    assert result.doc == _doc(_p(_t("@petya, @vasya and @petya")))
    assert result.warnings == ["Unknown handles kept as text: @petya, @vasya."]


def test_the_label_of_another_recording_is_a_person():
    other = NoteSpeakers(speakers=SPEAKERS.speakers, unnamed={})
    assert markdown_to_note("@[Unknown speaker 2]", other).doc == _doc(_p(_mention(None, "Unknown speaker 2", "person")))


def test_an_unnamed_speaker_of_another_recording_is_its_label_as_text():
    other = NoteSpeakers(speakers=SPEAKERS.speakers, unnamed={})
    assert note_to_markdown(_doc(_p(_mention(UNNAMED, "Unknown speaker 2"))), other) == "Unknown speaker 2"


def test_handle_of_a_speaker_without_a_name_is_not_used():
    nameless = NoteSpeakers(speakers=[NoteSpeaker(id="x", name=None, handle="ghost")], unnamed={})
    result = markdown_to_note("@ghost", nameless)
    assert result.doc == _doc(_p(_t("@ghost")))
    assert result.warnings == ["Unknown handles kept as text: @ghost."]


def test_a_note_without_a_doc_is_refused():
    with pytest.raises(ValueError):
        note_to_markdown({"type": "paragraph"}, SPEAKERS)


def test_unknown_nodes_keep_their_text():
    doc = _doc({"type": "codeBlock", "content": [_t("x = 1")]}, _p(_t("a"), {"type": "emoji", "attrs": {}}, _t("b")))
    assert note_to_markdown(doc, SPEAKERS) == "x = 1\n\nab"


def _round_trip(doc):
    markdown = note_to_markdown(doc, SPEAKERS)
    result = markdown_to_note(markdown, SPEAKERS)
    assert result.warnings == []
    return markdown, result.doc


def _link(href):
    return {"type": "link", "attrs": {"href": href, "target": "_blank", "rel": "noopener noreferrer nofollow", "class": None, "title": None}}


def _list(kind, *items, start=None):
    node = {"type": kind, "content": list(items)}
    if kind == "orderedList":
        node["attrs"] = {"start": start or 1, "type": None}
    return node


def _item(*content):
    return {"type": "listItem", "content": list(content)}


@pytest.mark.parametrize("doc", [
    # A link holding a timecode.
    _doc(_p({"type": "timecode", "attrs": {"seconds": 5}, "marks": [_link("https://example.com")]})),
    # An address with a space and letters beyond ASCII, as written.
    _doc(_p({**_t("doc"), "marks": [_link("https://пример.рф/a b")]})),
    # A line break at the start of a paragraph.
    _doc(_list("orderedList", _item(_p({"type": "hardBreak"}, _t("after"))))),
    # An empty item right under the text of its item.
    _doc(_list("bulletList", _item(_p(_t("a")), _list("bulletList", _item(_p()))))),
    # A quote in an item, ending with empty lines.
    _doc(_list("bulletList", _item(_p(_t("a")), {"type": "blockquote", "content": [_p(_t("q")), _p(), _p()]})), _p(_t("b"))),
    # A heading ending with #.
    _doc({"type": "heading", "attrs": {"level": 2}, "content": [_t("Issue #")]}),
    # What reads like an address of mail in angle brackets.
    _doc(_p(_t("a <8@example.com> b"))),
    # Italic right after bold, no space between.
    _doc(_p(_t("a ", ), _t("bold", "bold"), _t("then", "italic"), _t(" b"))),
])
def test_round_trips_found_by_random_notes(doc):
    _, back = _round_trip(doc)
    assert back == normalize(doc, SPEAKERS)


def test_empty_lines_at_the_end_of_the_last_item_go_after_the_list():
    doc = _doc(_list("bulletList", _item(_p(_t("a")), _p())), _p(_t("b")))
    assert normalize(doc, SPEAKERS) == _doc(_list("bulletList", _item(_p(_t("a")))), _p(), _p(_t("b")))


def test_a_line_break_at_the_end_of_a_paragraph_is_dropped():
    assert normalize(_doc(_p(_t("a"), {"type": "hardBreak"})), SPEAKERS) == _doc(_p(_t("a")))
