"""The text of a note as search sees it.

A note is the editor's (Tiptap) document. Every textblock (paragraph, heading,
the paragraph of a list item or a quote) is one block of text. Chips read as
the editor shows them: a speaker mention as the speaker's name now, a person
mention as its label, a timecode as [12:34].
"""

from collections.abc import Callable

TEXTBLOCKS = {"paragraph", "heading", "codeBlock"}


def note_blocks(doc: dict, name_of: Callable[[str], str | None] = lambda _id: None) -> list[str]:
    """The non-empty text blocks of a note document, in order."""
    blocks: list[str] = []
    _collect(doc, name_of, blocks)
    return blocks


def _collect(node, name_of, blocks: list[str]) -> None:
    if not isinstance(node, dict):
        return
    if node.get("type") in TEXTBLOCKS:
        text = " ".join("".join(_inline(child, name_of) for child in node.get("content") or []).split())
        if text:
            blocks.append(text)
        return
    for child in node.get("content") or []:
        _collect(child, name_of, blocks)


def _inline(node, name_of) -> str:
    if not isinstance(node, dict):
        return ""
    kind = node.get("type")
    attrs = node.get("attrs") or {}
    if kind == "text":
        return node.get("text") or ""
    if kind == "hardBreak":
        return " "
    if kind == "mention":
        name = name_of(attrs["id"]) if attrs.get("kind", "speaker") == "speaker" and attrs.get("id") else None
        return name or attrs.get("label") or ""
    if kind == "timecode":
        return f"[{format_clock(attrs.get('seconds') or 0)}]"
    return "".join(_inline(child, name_of) for child in node.get("content") or [])


def format_clock(seconds: float) -> str:
    """As the editor's timecode chip: 05:04, from one hour on 1:02:05."""
    total = max(0, int(seconds))
    hours, minutes, secs = total // 3600, total // 60 % 60, total % 60
    clock = f"{minutes:02d}:{secs:02d}"
    return f"{hours}:{clock}" if hours else clock
