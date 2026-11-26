"""The note of a recording as Markdown, and Markdown as a note.

A note is the document of the note editor (Tiptap JSON, schema in
ui/src/components/NoteEditor/). Here it becomes Markdown an agent can read and
write, and back:

- headings #, ## and ###; lists -, 1. and checkboxes - [ ] / - [x]; quotes >;
  **bold**, *italic*, [text](address); a line break inside a paragraph is \\ at the
  end of the line;
- a timecode is [12:34] ([1:02:03] from an hour on);
- a speaker of the base is @handle, someone not in the base @[Name], a speaker of the
  recording without a name yet @[Unknown speaker 2], the label the editor shows;
- each empty paragraph is one more empty line between blocks.

What Markdown has and the note does not (tables, images, code, deeper headings) is
made simpler, never refused, with a warning saying what was. Text that would read
as markup is escaped with a backslash.

A note → Markdown → note is the same note in its normal form (normalize(), listed
in docs/services/NoteMarkdown.md): a speaker's mention with the name they have
now, a timecode on a whole second, no spaces at the edges of a mark or a line, and
what Markdown cannot write otherwise. Fixtures shared with the editor's tests keep
both sides on one schema: tests/fixtures/notes.

Pure functions: no database, no network. What the caller knows about speakers
comes in as NoteSpeakers.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Mapping, Sequence

from markdown_it import MarkdownIt
from markdown_it.rules_core import StateCore
from markdown_it.rules_inline import StateInline
from markdown_it.token import Token

__all__ = ["NoteSpeaker", "NoteSpeakers", "NoteFromMarkdown", "note_to_markdown", "markdown_to_note", "normalize"]


@dataclass(frozen=True)
class NoteSpeaker:
    """A speaker of the base. One without a name has no handle and is not mentioned
    by it."""
    id: str
    name: str | None
    handle: str | None


@dataclass(frozen=True)
class NoteSpeakers:
    """The speakers of the base, and the labels of the speakers of this recording who
    have no name yet (id → "Unknown speaker 2"), as the editor shows them."""
    speakers: Sequence[NoteSpeaker]
    unnamed: Mapping[str, str] = field(default_factory=dict)

    def by_id(self, speaker_id: str | None) -> NoteSpeaker | None:
        return next((s for s in self.speakers if s.id == speaker_id), None)

    def by_handle(self, handle: str) -> NoteSpeaker | None:
        handle = handle.lower()
        return next((s for s in self.speakers if s.name and s.handle and s.handle.lower() == handle), None)

    def by_unnamed_label(self, label: str) -> str | None:
        return next((sid for sid, own in self.unnamed.items() if own == label), None)


@dataclass(frozen=True)
class NoteFromMarkdown:
    doc: dict
    # What was made simpler, one line each, in English.
    warnings: list[str]


# --- the document the editor saves -------------------------------------------------

MARK_ORDER = ("link", "bold", "italic")
LINK_DEFAULTS = {"target": "_blank", "rel": "noopener noreferrer nofollow", "class": None, "title": None}


def _text(value: str, marks: list | None = None) -> dict:
    node: dict = {"type": "text", "text": value}
    if marks:
        node["marks"] = marks
    return node


def _paragraph(content: list | None = None) -> dict:
    return {"type": "paragraph", "content": content} if content else {"type": "paragraph"}


def _mention(speaker_id: str | None, label: str, kind: str) -> dict:
    return {"type": "mention", "attrs": {"id": speaker_id, "label": label, "mentionSuggestionChar": "@", "kind": kind}}


def _link(href: str) -> dict:
    return {"type": "link", "attrs": {"href": href, **LINK_DEFAULTS}}


def _is_empty_paragraph(node: dict) -> bool:
    return node.get("type") == "paragraph" and not node.get("content")


def _plain_text(node: dict) -> str:
    if node.get("type") == "text":
        return node.get("text") or ""
    return "".join(_plain_text(child) for child in node.get("content") or [] if isinstance(child, dict))


def _canonical_marks(marks: list | None) -> list:
    by_type: dict[str, dict] = {}
    for mark in marks or []:
        kind = mark.get("type") if isinstance(mark, dict) else None
        if kind == "link":
            by_type["link"] = _link(str((mark.get("attrs") or {}).get("href") or ""))
        elif kind in ("bold", "italic"):
            by_type[kind] = {"type": kind}
    return [by_type[kind] for kind in MARK_ORDER if kind in by_type]


def normalize(doc: dict, speakers: NoteSpeakers) -> dict:
    """The note as it reads back from its Markdown: see the module docstring."""
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        raise ValueError("a note is a document of type doc")
    content = _blocks(doc.get("content"), speakers)
    if not any(not _is_empty_paragraph(block) for block in content):
        content = [_paragraph()]
    return {"type": "doc", "content": content}


def _blocks(nodes, speakers: NoteSpeakers) -> list[dict]:
    out = []
    for node in nodes or []:
        if isinstance(node, dict):
            out.extend(_block(node, speakers))
    return out


def _block(node: dict, speakers: NoteSpeakers) -> list[dict]:
    kind = node.get("type")
    attrs = node.get("attrs") or {}
    if kind == "paragraph":
        return [_paragraph(_inline(node.get("content"), speakers))]
    if kind == "heading":
        level = attrs.get("level")
        level = min(max(int(level), 1), 3) if isinstance(level, (int, float)) else 1
        content = _inline(node.get("content"), speakers, breaks_as_spaces=True)
        return [{"type": "heading", "attrs": {"level": level}, **({"content": content} if content else {})}]
    if kind == "blockquote":
        content = _blocks(node.get("content"), speakers)
        # A quote of nothing but empty lines is one empty line in Markdown.
        if all(_is_empty_paragraph(block) for block in content):
            content = [_paragraph()]
        return [{"type": "blockquote", "content": content}]
    if kind in ("bulletList", "orderedList", "taskList"):
        item_kind = "taskItem" if kind == "taskList" else "listItem"
        items = [_item(child, item_kind, speakers) for child in node.get("content") or [] if isinstance(child, dict)]
        if not items:
            return []
        # Empty lines after the last item are after the list in Markdown.
        after = []
        while len(items[-1]["content"]) > 1 and _is_empty_paragraph(items[-1]["content"][-1]):
            after.append(items[-1]["content"].pop())
        if kind == "orderedList":
            start = attrs.get("start")
            start = int(start) if isinstance(start, (int, float)) and start >= 0 else 1
            return [{"type": "orderedList", "attrs": {"start": start, "type": None}, "content": items}, *after]
        return [{"type": kind, "content": items}, *after]
    # Anything else the editor does not have: its text as a paragraph.
    text = _plain_text(node).strip()
    return [_paragraph([_text(text)])] if text else []


def _item(node: dict, kind: str, speakers: NoteSpeakers) -> dict:
    content = _blocks(node.get("content"), speakers)
    if not content or content[0]["type"] != "paragraph":
        content.insert(0, _paragraph())
    if kind == "taskItem":
        return {"type": "taskItem", "attrs": {"checked": bool((node.get("attrs") or {}).get("checked"))}, "content": content}
    # An item with nothing on its first line goes straight on to its next block:
    # empty lines there would end the item, and a paragraph would become its first.
    if _is_empty_paragraph(content[0]) and len(content) > 1:
        rest = content[1:]
        while rest and _is_empty_paragraph(rest[0]):
            rest.pop(0)
        content = rest if rest and rest[0]["type"] == "paragraph" else [content[0], *rest]
    return {"type": "listItem", "content": content}


def _inline(nodes, speakers: NoteSpeakers, breaks_as_spaces: bool = False) -> list[dict]:
    out: list[dict] = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        kind = node.get("type")
        marks = _canonical_marks(node.get("marks"))
        if kind == "text":
            if node.get("text"):
                out.append(_text(node["text"], marks))
        elif kind == "hardBreak":
            out.append(_text(" ") if breaks_as_spaces else {"type": "hardBreak"})
        elif kind == "timecode":
            seconds = (node.get("attrs") or {}).get("seconds")
            seconds = math.floor(seconds) if isinstance(seconds, (int, float)) and math.isfinite(seconds) and seconds > 0 else 0
            out.append({"type": "timecode", "attrs": {"seconds": seconds}, **({"marks": marks} if marks else {})})
        elif kind == "mention":
            out.extend(_mention_now(node.get("attrs") or {}, marks, speakers))
        else:
            text = _plain_text(node)
            if text:
                out.append(_text(text, marks))
    return _tidy(out)


def _mention_now(attrs: dict, marks: list, speakers: NoteSpeakers) -> list[dict]:
    """A mention as it is now: a speaker by the name they have, someone not in the
    base as they were written; a speaker who cannot be written in Markdown (gone, or
    without a name outside this recording) as the name last seen, in text."""
    label = str(attrs.get("label") or "")
    if (attrs.get("kind") or "speaker") != "speaker":
        node = _mention(None, label, "person") if label else None
    elif attrs.get("id") in speakers.unnamed:
        node = _mention(attrs["id"], speakers.unnamed[attrs["id"]], "speaker")
    else:
        speaker = speakers.by_id(attrs.get("id"))
        if speaker and speaker.name and speaker.handle:
            node = _mention(speaker.id, speaker.name, "speaker")
        else:
            node = None
            label = (speaker.name if speaker and speaker.name else None) or label
    if node is None:
        return [_text(label, marks)] if label else []
    if marks:
        node["marks"] = marks
    return [node]


def _same_marks(a: dict, b: dict) -> bool:
    return a.get("marks", []) == b.get("marks", [])


def _merge(nodes: list[dict]) -> list[dict]:
    out: list[dict] = []
    for node in nodes:
        if node["type"] == "text" and not node["text"]:
            continue
        if node["type"] == "text" and out and out[-1]["type"] == "text" and _same_marks(out[-1], node):
            out[-1] = _text(out[-1]["text"] + node["text"], out[-1].get("marks"))
        else:
            out.append(node)
    return out


def _tidy(nodes: list[dict]) -> list[dict]:
    """No spaces at the edges of a paragraph, a line or a mark; one text node per run
    of the same marks."""
    nodes = _merge(nodes)
    for kind in MARK_ORDER:
        nodes = _merge(_spaces_out_of(kind, nodes))
    # Edges of the paragraph and of each line.
    lines: list[list[dict]] = [[]]
    for node in nodes:
        if node["type"] == "hardBreak":
            lines.append([])
        else:
            lines[-1].append(node)
    for line in lines:
        if line and line[0]["type"] == "text":
            line[0] = _text(line[0]["text"].lstrip(), line[0].get("marks"))
        if line and line[-1]["type"] == "text":
            line[-1] = _text(line[-1]["text"].rstrip(), line[-1].get("marks"))
        line[:] = [node for node in line if node["type"] != "text" or node["text"]]
    # A line break at the end of a paragraph has nothing after it in Markdown.
    while len(lines) > 1 and not lines[-1]:
        lines.pop()
    out: list[dict] = []
    for i, line in enumerate(lines):
        if i:
            out.append({"type": "hardBreak"})
        out.extend(line)
    return out


def _has(node: dict, kind: str, like: dict | None = None) -> bool:
    return any(m["type"] == kind and (like is None or m == like) for m in node.get("marks", []))


def _without(node: dict, kind: str) -> list | None:
    return [m for m in node.get("marks", []) if m["type"] != kind] or None


def _spaces_out_of(kind: str, nodes: list[dict]) -> list[dict]:
    """Spaces at the edges of each run of a mark moved out of it, or dropped when a
    space is already there."""
    nodes = list(nodes)
    i = 0
    while i < len(nodes):
        if not _has(nodes[i], kind):
            i += 1
            continue
        mark = next(m for m in nodes[i]["marks"] if m["type"] == kind)
        end = i
        while end + 1 < len(nodes) and _has(nodes[end + 1], kind, mark):
            end += 1
        run = nodes[i:end + 1]
        if all(n["type"] == "text" and not n["text"].strip() for n in run):
            nodes[i:end + 1] = [_text(n["text"], _without(n, kind)) for n in run]
            i = end + 1
            continue
        first, last = run[0], run[-1]
        before, after = [], []
        if first["type"] == "text" and first["text"][:1].isspace():
            space = first["text"][: len(first["text"]) - len(first["text"].lstrip())]
            run[0] = _text(first["text"].lstrip(), first.get("marks"))
            if not (i > 0 and nodes[i - 1]["type"] == "text" and nodes[i - 1]["text"][-1:].isspace()):
                before = [_text(space, _without(first, kind))]
        last = run[-1]
        if last["type"] == "text" and last["text"][-1:].isspace():
            space = last["text"][len(last["text"].rstrip()):]
            run[-1] = _text(last["text"].rstrip(), last.get("marks"))
            if not (end + 1 < len(nodes) and nodes[end + 1]["type"] == "text" and nodes[end + 1]["text"][:1].isspace()):
                after = [_text(space, _without(last, kind))]
        nodes[i:end + 1] = before + run + after
        i += len(before) + len(run) + len(after)
    return nodes


# --- note → Markdown -----------------------------------------------------------------

def note_to_markdown(doc: dict, speakers: NoteSpeakers) -> str:
    """The note as Markdown. A note with nothing in it is an empty string."""
    doc = normalize(doc, speakers)
    if all(_is_empty_paragraph(block) for block in doc["content"]):
        return ""
    lines = _write_blocks(doc["content"], speakers)
    text = "\n".join(lines)
    # Empty paragraphs at the end: the final newline is not one of them.
    return text + "\n" if lines and lines[-1] == "" else text


def _write_blocks(blocks: list[dict], speakers: NoteSpeakers, in_item: bool = False, task: bool = False) -> list[str]:
    lines: list[str] = []
    empty = 0
    last: dict | None = None
    previous: tuple[str, str] | None = None  # (family, marker) of the block before
    for index, block in enumerate(blocks):
        # The text of a checkbox is on its line even when empty: [ ] is in it.
        if _is_empty_paragraph(block) and not (task and index == 0):
            empty += 1
            continue
        if last is None:
            lines.extend([""] * empty)
        elif empty == 0 and in_item and last["type"] == "paragraph" and _interrupts(block):
            # A list right under the text of its item, as Markdown is usually written.
            pass
        else:
            lines.extend([""] * (1 + empty))
        empty = 0
        written, previous = _write_block(block, speakers, previous)
        lines.extend(written)
        last = block
    lines.extend([""] * empty)
    return lines


def _interrupts(block: dict) -> bool:
    """Whether the block can start on the line right after a paragraph: a list whose
    first line has text (a lone - there would underline the paragraph as a heading)."""
    if block["type"] == "taskList":
        return True
    first = block["content"][0]["content"][0] if block["type"] in ("bulletList", "orderedList") else None
    if first is None or _is_empty_paragraph(first):
        return False
    return block["type"] == "bulletList" or block["attrs"]["start"] == 1


def _write_block(block: dict, speakers: NoteSpeakers, previous: tuple[str, str] | None) -> tuple[list[str], tuple[str, str] | None]:
    kind = block["type"]
    if kind == "paragraph":
        return _write_inline(block.get("content", []), speakers).split("\n"), None
    if kind == "heading":
        text = _write_inline(block.get("content", []), speakers)
        # A # at the end would close the heading: kept as text.
        text = re.sub(r"(^|\s)(#+)$", lambda m: m.group(1) + "\\" + m.group(2), text)
        return ["#" * block["attrs"]["level"] + (" " + text if text else "")], None
    if kind == "blockquote":
        inner = _write_blocks(block["content"], speakers)
        return [("> " + line) if line else ">" for line in inner], None
    # Lists: the same kind of list right after another one changes its marker, or the
    # two would read as one.
    family = "ordered" if kind == "orderedList" else "bullet"
    markers = (".", ")") if family == "ordered" else ("-", "*")
    marker = markers[1] if previous == (family, markers[0]) else markers[0]
    lines: list[str] = []
    for index, item in enumerate(block["content"]):
        number = f"{block['attrs']['start'] + index}{marker} " if family == "ordered" else f"{marker} "
        inner = _write_blocks(item["content"], speakers, in_item=True, task=item["type"] == "taskItem") or [""]
        first = inner[0]
        if item["type"] == "taskItem":
            box = "[x]" if item["attrs"]["checked"] else "[ ]"
            first = f"{box} {first}" if first else box
        lines.append((number + first).rstrip() if first else number.rstrip())
        pad = " " * len(number)
        lines.extend((pad + line) if line else "" for line in inner[1:])
    return lines, (family, marker)


def _clock(seconds: int) -> str:
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


# Where an address written out becomes a link, as the editor makes one while typing.
_URL = re.compile(r"(?:https?://|www\.)[^\s<>]*", re.IGNORECASE)
_URL_START = re.compile(r"(?:https?(?=://)|www(?=\.))", re.IGNORECASE)
_URL_TRAILING = ".,;:!?'\")]*_~"
_LINE_START = re.compile(r"#{1,6}(?:\s|$)|[-+](?:\s|$)|\d{1,9}[.)](?:\s|$)|>|(?:=+|-+)\s*$")
_HANDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def _url_at(text: str, pos: int) -> int:
    """The end of the address that starts at pos, or -1."""
    if pos > 0 and text[pos - 1].isalnum():
        return -1
    found = _URL.match(text, pos)
    if not found:
        return -1
    end = found.end()
    while end > pos and text[end - 1] in _URL_TRAILING:
        end -= 1
    scheme = found.group(0).lower()
    least = len("www.") if scheme.startswith("www.") else scheme.index("//") + 2
    return end if end - pos > least else -1


class _InlineWriter:
    def __init__(self) -> None:
        self.out: list[str] = []
        self.open: list[dict] = []
        self.line_start = True
        self.after_handle = False
        # The delimiter each open bold or italic was opened with.
        self.delimiters: dict[str, str] = {}
        self.star_last = False

    @property
    def last(self) -> str:
        for piece in reversed(self.out):
            if piece:
                return piece[-1]
        return ""

    def put(self, piece: str, star: bool = False) -> None:
        self.out.append(piece)
        if piece:
            self.line_start = False
            self.star_last = star

    def marks_to(self, marks: list[dict], longest: dict[str, int] | None = None, after: dict[str, str] | None = None) -> None:
        """Close what ends, open what starts: the mark that goes on longest outside."""
        keep = 0
        while keep < len(self.open) and self.open[keep] in marks:
            keep += 1
        for mark in reversed(self.open[keep:]):
            self.close(mark)
        self.open = self.open[:keep]
        for mark in sorted(marks, key=lambda m: -(longest or {}).get(m["type"], 0)):
            if mark not in self.open:
                kind = mark["type"]
                if kind == "link":
                    self.put("[")
                else:
                    # Right after a closing * delimiter, * would join it in one run; _ does
                    # not, unless a letter follows the run, where _ cannot close.
                    under = self.star_last and not (after or {}).get(kind, "").isalnum()
                    delimiter = ("__" if kind == "bold" else "_") if under else ("**" if kind == "bold" else "*")
                    self.delimiters[kind] = delimiter
                    self.put(delimiter)
                self.open.append(mark)

    def close(self, mark: dict) -> None:
        if mark["type"] == "link":
            self.put("](" + _destination(mark["attrs"]["href"]) + ")")
        else:
            delimiter = self.delimiters.pop(mark["type"], "**" if mark["type"] == "bold" else "*")
            self.put(delimiter, star=delimiter[0] == "*")

    def text(self, value: str, in_link: bool, after: str = "") -> None:
        escaped = []
        # What would start a block at the start of a line: its mark escaped (1\. for a number).
        line_mark = -1
        if self.line_start and _LINE_START.match(value):
            line_mark = len(value) - len(value.lstrip("0123456789"))
        # https\:// or www\. keeps an address text, wherever one could start.
        url_ends: set[int] = set()
        if not in_link:
            for found in _URL_START.finditer(value):
                if found.start() == 0 and self.last.isalnum() or found.start() > 0 and value[found.start() - 1].isalnum():
                    continue
                url_ends.add(found.end())
        prev = self.last
        for i, char in enumerate(value):
            following = value[i + 1] if i + 1 < len(value) else after
            if i == line_mark:
                escaped.append("\\" + char)
            elif char in "\\*[]`":
                escaped.append("\\" + char)
            elif char == "_" and not (prev.isalnum() and following.isalnum()):
                escaped.append("\\_")
            elif char == "~" and (prev == "~" or following == "~"):
                escaped.append("\\~")
            elif char == "<" and following and not following.isspace():
                escaped.append("\\<")
            elif char == "&" and re.match(r"#?[0-9A-Za-z]+;", value[i + 1:]):
                escaped.append("\\&")
            elif char == "@" and not prev.isalnum() and (following == "[" or (following.isascii() and following.isalnum())):
                escaped.append("\\@")
            elif char == "(" and i == 0 and prev == "]":
                escaped.append("\\(")
            elif i == 0 and self.after_handle and char in "._-" and following.isascii() and following.isalnum():
                escaped.append("\\" + char)
            elif i in url_ends:
                escaped.append("\\" + char)
            else:
                escaped.append(char)
            prev = char
        self.after_handle = False
        self.put("".join(escaped))


def _destination(href: str) -> str:
    if re.search(r"[\s<>]", href):
        return "<" + href.replace("\\", "\\\\").replace("<", "\\<").replace(">", "\\>") + ">"
    return href.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _bare_link(nodes: list[dict], i: int) -> bool:
    """Whether the link of nodes[i] can be written as the address alone."""
    node = nodes[i]
    marks = node.get("marks", [])
    if node["type"] != "text" or len(marks) != 1 or marks[0]["type"] != "link":
        return False
    href = marks[0]["attrs"]["href"]
    if node["text"] != href or not re.match(r"https?://", href, re.IGNORECASE) or _url_at(href, 0) != len(href):
        return False
    before = nodes[i - 1] if i > 0 else None
    after = nodes[i + 1] if i + 1 < len(nodes) else None
    if before is not None and _has(before, "link", marks[0]):
        return False
    if after is not None and _has(after, "link", marks[0]):
        return False
    if before is not None and not (before["type"] == "text" and not before["text"][-1:].isalnum()):
        return False
    if after is None or after["type"] == "hardBreak":
        return True
    return after["type"] == "text" and (after["text"][:1].isspace() or after["text"][:1] in ".,;:!?)")


def _run_lengths(nodes: list[dict], i: int) -> dict[str, int]:
    """How many nodes from i on keep each mark of nodes[i]."""
    lengths = {}
    for mark in nodes[i].get("marks", []):
        end = i
        while end + 1 < len(nodes) and mark in nodes[end + 1].get("marks", []):
            end += 1
        lengths[mark["type"]] = end - i + 1
    return lengths


def _after_runs(nodes: list[dict], i: int) -> dict[str, str]:
    """What comes right after the run of each mark of nodes[i]."""
    after = {}
    for kind, length in _run_lengths(nodes, i).items():
        end = i + length
        after[kind] = _first_char(nodes[end] if end < len(nodes) else None)
    return after


def _first_char(node: dict | None) -> str:
    """What the next node starts with in Markdown, near enough for escaping."""
    if node is None:
        return ""
    return {"text": (node.get("text") or "")[:1], "mention": "@", "timecode": "[", "hardBreak": "\\"}.get(node["type"], "")


def _write_inline(nodes: list[dict], speakers: NoteSpeakers) -> str:
    writer = _InlineWriter()
    for i, node in enumerate(nodes):
        marks = node.get("marks", [])
        if node["type"] == "text" and _bare_link(nodes, i):
            writer.marks_to([])
            writer.put(node["text"])
            continue
        if node["type"] == "hardBreak":
            writer.marks_to([])
            writer.put("\\\n")
            writer.line_start = True
            continue
        writer.marks_to(marks, _run_lengths(nodes, i), _after_runs(nodes, i))
        in_link = any(m["type"] == "link" for m in marks)
        if node["type"] == "text":
            writer.text(node["text"], in_link, _first_char(nodes[i + 1] if i + 1 < len(nodes) else None))
        elif node["type"] == "timecode":
            writer.put(f"[{_clock(node['attrs']['seconds'])}]")
        elif node["type"] == "mention":
            attrs = node["attrs"]
            speaker = speakers.by_id(attrs["id"]) if attrs["kind"] == "speaker" and attrs["id"] not in speakers.unnamed else None
            if speaker:
                writer.put("@" + speaker.handle)
                writer.after_handle = True
                continue
            label = re.sub(r"([\\\[\]])", r"\\\1", attrs["label"])
            writer.put(f"@[{label}]")
    writer.marks_to([])
    return "".join(writer.out)


# --- Markdown → note -----------------------------------------------------------------

_WARNINGS = {
    "heading": "Headings below level 3 became level 3.",
    "code_inline": "Inline code became plain text.",
    "strike": "Strikethrough was removed.",
    "code_block": "Code blocks became plain text.",
    "image": "Images became links.",
    "table": "Tables became plain text.",
    "hr": "Horizontal rules were removed.",
    "html": "HTML was kept as text.",
}
_TIMECODE = re.compile(r"\[(?:(\d+):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))\]")
_TASK = re.compile(r"\[([ xX])\](?: |$)")


def _timecode_rule(state: StateInline, silent: bool) -> bool:
    # Silent while a link's text is measured: its brackets count as brackets there, or
    # a link holding a timecode would not be found.
    if silent or state.src[state.pos] != "[":
        return False
    found = _TIMECODE.match(state.src, state.pos)
    if not found or state.src[found.end():found.end() + 1] == "(":
        return False
    if not silent:
        h, m, s, m2, s2 = found.groups()
        seconds = int(h) * 3600 + int(m) * 60 + int(s) if h is not None else int(m2) * 60 + int(s2)
        token = state.push("timecode", "", 0)
        token.meta = {"seconds": seconds}
    state.pos = found.end()
    return True


def _mention_rule(state: StateInline, silent: bool) -> bool:
    src, pos = state.src, state.pos
    if src[pos] != "@" or (pos > 0 and src[pos - 1].isalnum()):
        return False
    speakers: NoteSpeakers = state.env["speakers"]
    if src[pos + 1:pos + 2] == "[":
        label, i = [], pos + 2
        while i < state.posMax and src[i] not in "]\n":
            if src[i] == "\\" and i + 1 < state.posMax and src[i + 1] in "\\[]":
                i += 1
            label.append(src[i])
            i += 1
        name = "".join(label).strip()
        if i >= state.posMax or src[i] != "]" or not name or src[i + 1:i + 2] == "(":
            return False
        if not silent:
            unnamed = speakers.by_unnamed_label(name)
            token = state.push("mention", "", 0)
            token.meta = {"id": unnamed, "label": name, "kind": "speaker" if unnamed else "person"}
        state.pos = i + 1
        return True
    found = _HANDLE.match(src, pos + 1, state.posMax)
    if not found:
        return False
    handle = found.group(0)
    # Punctuation after a handle is not part of it.
    while handle and speakers.by_handle(handle) is None and handle[-1] in "._-":
        handle = handle[:-1]
    speaker = speakers.by_handle(handle) if handle else None
    if speaker is None:
        if not silent:
            unknown = state.env["unknown"]
            name = found.group(0).rstrip("._-").lower()
            if name not in unknown:
                unknown.append(name)
        return False
    if not silent:
        token = state.push("mention", "", 0)
        token.meta = {"id": speaker.id, "label": speaker.name, "kind": "speaker"}
    state.pos = pos + 1 + len(handle)
    return True


def _bare_links_rule(state: StateCore) -> None:
    """An address written out is a link, before escaped characters join the text
    (https\\:// stays text)."""
    for block in state.tokens:
        if block.type != "inline" or not block.children:
            continue
        out: list[Token] = []
        depth = 0
        for token in block.children:
            if token.type == "link_open":
                depth += 1
            elif token.type == "link_close":
                depth -= 1
            if token.type != "text" or depth:
                out.append(token)
                continue
            text, pos, last = token.content, 0, 0
            while pos < len(text):
                end = _url_at(text, pos)
                if end < 0:
                    pos += 1
                    continue
                if pos > last:
                    out.append(_token("text", text[last:pos]))
                address = text[pos:end]
                href = address if "://" in address else "http://" + address
                opening = Token("link_open", "a", 1, attrs={"href": href}, markup="linkify")
                out.extend([opening, _token("text", address), Token("link_close", "a", -1, markup="linkify")])
                pos = last = end
            if last == 0:
                out.append(token)
            elif last < len(text):
                out.append(_token("text", text[last:]))
        block.children = out


def _token(kind: str, content: str) -> Token:
    token = Token(kind, "", 0)
    token.content = content
    return token


def _parser() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": True}).enable(["table", "strikethrough"])
    # Addresses as written: no percent-encoding of spaces or of letters beyond ASCII.
    md.normalizeLink = lambda url: url  # type: ignore[method-assign]
    md.normalizeLinkText = lambda url: url  # type: ignore[method-assign]
    md.inline.ruler.before("link", "timecode", _timecode_rule)
    md.inline.ruler.before("link", "mention", _mention_rule)
    md.core.ruler.before("text_join", "bare_links", _bare_links_rule)
    return md


_MD = _parser()


@dataclass
class _Block:
    token: Token
    children: list["_Block"] = field(default_factory=list)


def _tree(tokens: list[Token]) -> list[_Block]:
    root = _Block(Token("root", "", 1))
    stack = [root]
    for token in tokens:
        if token.nesting == -1:
            stack.pop()
            continue
        node = _Block(token)
        stack[-1].children.append(node)
        if token.nesting == 1:
            stack.append(node)
    return root.children


class _Reader:
    def __init__(self, text: str, speakers: NoteSpeakers):
        self.speakers = speakers
        self.env: dict = {"speakers": speakers, "unknown": []}
        self.found: list[str] = []
        self.lines = text.split("\n")
        self.tree = _tree(_MD.parse(text, self.env))

    def warn(self, kind: str) -> None:
        if kind not in self.found:
            self.found.append(kind)

    def blank(self, index: int, depth: int) -> bool:
        line = self.lines[index] if index < len(self.lines) else ""
        for _ in range(depth):
            line = line.lstrip()
            if not line.startswith(">"):
                break
            line = line[1:]
        return not line.strip()

    def quote_blank(self, index: int, depth: int) -> bool:
        """An empty line of the quote at this depth: its > marks there, nothing else."""
        line = self.lines[index] if index < len(self.lines) else ""
        for _ in range(depth):
            line = line.lstrip()
            if not line.startswith(">"):
                return False
            line = line[1:]
        return not line.strip()

    def content_end(self, block: _Block, depth: int) -> int:
        start, end = block.token.map
        while end - 1 > start and self.blank(end - 1, depth):
            end -= 1
        return end

    def longest_blank_run(self, start: int, end: int, depth: int) -> int:
        best = run = 0
        for index in range(start, end):
            run = run + 1 if self.blank(index, depth) else 0
            best = max(best, run)
        return best

    def sequence(self, blocks: list[_Block], depth: int, start: int, end: int, leading: bool, trailing: bool, quoted: bool = False) -> list[dict]:
        # Empty lines at the edges of a quote are its own only with its > marks.
        edge = self.quote_blank if quoted else self.blank
        out: list[dict] = []
        previous_end: int | None = None
        for block in blocks:
            if block.token.map is None:
                continue
            first = block.token.map[0]
            if previous_end is None:
                if leading:
                    index = start
                    while index < first and edge(index, depth):
                        out.append(_paragraph())
                        index += 1
            else:
                out.extend(_paragraph() for _ in range(self.longest_blank_run(previous_end, first, depth) - 1))
            out.extend(self.block(block, depth))
            previous_end = self.content_end(block, depth)
        if trailing and previous_end is not None:
            index = end - 1
            # A quote inside a list item may count the empty line after it as its own.
            while quoted and index >= previous_end and not edge(index, depth) and self.blank(index, depth):
                index -= 1
            while index >= previous_end and edge(index, depth):
                out.append(_paragraph())
                index -= 1
        return out

    def block(self, block: _Block, depth: int) -> list[dict]:
        token = block.token
        kind = token.type
        if kind == "paragraph_open":
            return [_paragraph(self.inline(block.children[0]))]
        if kind == "heading_open":
            level = int(token.tag[1])
            if level > 3:
                self.warn("heading")
            content = self.inline(block.children[0])
            return [{"type": "heading", "attrs": {"level": min(level, 3)}, **({"content": content} if content else {})}]
        if kind == "blockquote_open":
            start, end = token.map
            return [{"type": "blockquote", "content": self.sequence(block.children, depth + 1, start, end, True, True, quoted=True) or [_paragraph()]}]
        if kind in ("bullet_list_open", "ordered_list_open"):
            return self.list(block, depth)
        if kind in ("fence", "code_block"):
            self.warn("code_block")
            return [_paragraph(self.lines_of(token.content))]
        if kind == "html_block":
            self.warn("html")
            return [_paragraph(self.lines_of(token.content))]
        if kind == "hr":
            self.warn("hr")
            return []
        if kind == "table_open":
            self.warn("table")
            rows = []
            for row in _rows(block):
                cells = [self.inline(cell.children[0]) if cell.children else [] for cell in row.children]
                content: list[dict] = []
                for i, cell in enumerate(cells):
                    if i:
                        content.append(_text(" | "))
                    content.extend(cell)
                rows.append(_paragraph(content))
            return rows
        return []

    def lines_of(self, text: str) -> list[dict]:
        content: list[dict] = []
        for i, line in enumerate(text.rstrip("\n").split("\n")):
            if i:
                content.append({"type": "hardBreak"})
            if line:
                content.append(_text(line))
        return content

    def list(self, block: _Block, depth: int) -> list[dict]:
        ordered = block.token.type == "ordered_list_open"
        start = int(block.token.attrGet("start") or 1) if ordered else 1
        items = [child for child in block.children if child.token.type == "list_item_open"]
        lists: list[dict] = []
        for index, item in enumerate(items):
            last = index == len(items) - 1
            item_start, item_end = item.token.map
            checked = None if ordered else self.task(item)
            content = self.sequence(item.children, depth, item_start, item_end, False, not last)
            if not content or content[0]["type"] != "paragraph":
                content.insert(0, _paragraph())
            if checked is None:
                node = {"type": "listItem", "content": content}
                kind = "orderedList" if ordered else "bulletList"
            else:
                node = {"type": "taskItem", "attrs": {"checked": checked}, "content": content}
                kind = "taskList"
            if lists and lists[-1]["type"] == kind:
                lists[-1]["content"].append(node)
            elif kind == "orderedList":
                lists.append({"type": kind, "attrs": {"start": start + index, "type": None}, "content": [node]})
            else:
                lists.append({"type": kind, "content": [node]})
        return lists

    def task(self, item: _Block) -> bool | None:
        """Whether the item is a checkbox, and ticked; its mark is taken out of its text."""
        first = item.children[0] if item.children else None
        if first is None or first.token.type != "paragraph_open":
            return None
        inline = first.children[0].token
        found = _TASK.match(inline.content)
        if not found:
            return None
        inline.content = inline.content[found.end():]
        inline.children = _MD.parseInline(inline.content, self.env)[0].children if inline.content else []
        return found.group(1) != " "

    def inline(self, block: _Block) -> list[dict]:
        out: list[dict] = []
        marks: list[dict] = []
        for token in block.token.children or []:
            kind = token.type
            if kind in ("text", "text_special"):
                out.append(_text(token.content, list(marks)))
            elif kind == "softbreak":
                out.append(_text(" ", list(marks)))
            elif kind == "hardbreak":
                out.append({"type": "hardBreak"})
            elif kind in ("strong_open", "em_open"):
                marks.append({"type": "bold" if kind == "strong_open" else "italic"})
            elif kind in ("strong_close", "em_close"):
                _drop_last(marks, "bold" if kind == "strong_close" else "italic")
            elif kind == "link_open":
                marks.append(_link(str(token.attrGet("href") or "")))
            elif kind == "link_close":
                _drop_last(marks, "link")
            elif kind in ("s_open", "s_close"):
                self.warn("strike")
            elif kind == "code_inline":
                self.warn("code_inline")
                out.append(_text(token.content, list(marks)))
            elif kind == "html_inline":
                self.warn("html")
                out.append(_text(token.content, list(marks)))
            elif kind == "image":
                self.warn("image")
                alt = token.content or str(token.attrGet("src") or "")
                out.append(_text(alt, list(marks) + [_link(str(token.attrGet("src") or ""))]))
            elif kind == "timecode":
                out.append({"type": "timecode", "attrs": {"seconds": token.meta["seconds"]}, **({"marks": list(marks)} if marks else {})})
            elif kind == "mention":
                node = _mention(token.meta["id"], token.meta["label"], token.meta["kind"])
                if marks:
                    node["marks"] = list(marks)
                out.append(node)
        for node in out:
            if "marks" in node:
                node["marks"] = _canonical_marks(node["marks"])
                if not node["marks"]:
                    del node["marks"]
        return out

    def warnings(self) -> list[str]:
        found = [_WARNINGS[kind] for kind in self.found]
        if self.env["unknown"]:
            found.append("Unknown handles kept as text: " + ", ".join("@" + h for h in self.env["unknown"]) + ".")
        return found


def _rows(table: _Block) -> list[_Block]:
    rows = []
    for part in table.children:
        rows.extend(row for row in part.children if row.token.type == "tr_open")
    return rows


def _drop_last(marks: list[dict], kind: str) -> None:
    for i in range(len(marks) - 1, -1, -1):
        if marks[i]["type"] == kind:
            del marks[i]
            return


def markdown_to_note(text: str, speakers: NoteSpeakers) -> NoteFromMarkdown:
    """Markdown as a note, with what was made simpler. Nothing is refused."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text.endswith("\n"):
        text = text[:-1]
    if not text.strip():
        return NoteFromMarkdown(doc={"type": "doc", "content": [_paragraph()]}, warnings=[])
    reader = _Reader(text, speakers)
    content = reader.sequence(reader.tree, 0, 0, len(reader.lines), True, True)
    doc = normalize({"type": "doc", "content": content}, speakers)
    return NoteFromMarkdown(doc=doc, warnings=reader.warnings())
