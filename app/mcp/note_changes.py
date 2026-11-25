"""What the note tools do to a note, and what they answer: pure functions over
the editor's document and the Markdown of app/services/note_markdown.py. No
MCP imports and no database here; app/mcp/note_tools.py reads and writes.

Every refusal is a NoteToolError of one line: what happened, then what to do.
"""
from __future__ import annotations

from app.services.note_markdown import NoteFromMarkdown, NoteSpeakers, markdown_to_note, normalize, note_to_markdown

# Reads and writes of a note that changes in between, before giving up.
ATTEMPTS = 3

EMPTY_NOTE = {"type": "doc", "content": [{"type": "paragraph"}]}
UNKNOWN_HANDLES = "Unknown handles kept as text:"
HANDLE_HINT = "Use list_speakers for handles, or @[Name] for someone not in Sonorus."


class NoteToolError(Exception):
    """A refusal the agent reads as it is."""


def not_found(recording_id: int) -> NoteToolError:
    return NoteToolError(f"Recording {recording_id} not found: use list_recordings to see recording_ids.")


def keeps_changing(recording_id: int) -> NoteToolError:
    return NoteToolError(
        f"The note of recording {recording_id} keeps changing while it is written: try again in a moment."
    )


def changed_since(recording_id: int, read: int | None, now: int | None) -> NoteToolError:
    def name(version):
        return f"version {version}" if version else "no note"
    return NoteToolError(
        f"The note of recording {recording_id} changed since {name(read)} (now {name(now)}): "
        "read it with get_note and replace again."
    )


def is_empty(doc: dict, speakers: NoteSpeakers) -> bool:
    return normalize(doc, speakers) == EMPTY_NOTE


def same_note(a: dict, b: dict, speakers: NoteSpeakers) -> bool:
    """The two read back as the same Markdown: writing one over the other
    changes nothing."""
    return normalize(a, speakers) == normalize(b, speakers)


def _with_hints(result: NoteFromMarkdown) -> NoteFromMarkdown:
    warnings = [f"{line} {HANDLE_HINT}" if line.startswith(UNKNOWN_HANDLES) else line for line in result.warnings]
    return NoteFromMarkdown(doc=result.doc, warnings=warnings)


def _is_empty_paragraph(block: dict) -> bool:
    return block.get("type") == "paragraph" and not block.get("content")


def appended(stored: dict | None, markdown: str, speakers: NoteSpeakers, *, recording_id: int) -> NoteFromMarkdown:
    """The note with the Markdown added after it as new blocks. The note stays
    as it was stored, so the open editor sees only the new blocks change."""
    added = _with_hints(markdown_to_note(markdown, speakers))
    blocks = list(added.doc["content"])
    while blocks and _is_empty_paragraph(blocks[0]):
        blocks.pop(0)
    while blocks and _is_empty_paragraph(blocks[-1]):
        blocks.pop()
    if not blocks:
        raise NoteToolError(f"Nothing to append to the note of recording {recording_id}: pass the Markdown to add.")
    if stored is None or is_empty(stored, speakers):
        return NoteFromMarkdown(doc={"type": "doc", "content": blocks}, warnings=added.warnings)
    return NoteFromMarkdown(doc={**stored, "content": [*stored.get("content", []), *blocks]}, warnings=added.warnings)


def replaced(markdown: str, speakers: NoteSpeakers) -> NoteFromMarkdown:
    """The Markdown as the whole note."""
    return _with_hints(markdown_to_note(markdown, speakers))


def _places(text: str, part: str) -> int:
    """How many times part is in text, overlapping places counted."""
    count, at = 0, text.find(part)
    while at != -1:
        count += 1
        at = text.find(part, at + 1)
    return count


def edited(stored: dict | None, old_text: str, new_text: str, speakers: NoteSpeakers,
           *, recording_id: int) -> NoteFromMarkdown:
    """The note with old_text, found exactly once in its Markdown (as get_note
    gives it), replaced by new_text."""
    if not old_text:
        raise NoteToolError("old_text is empty: pass the exact text to replace, copied from get_note.")
    if stored is None:
        raise NoteToolError(f"Recording {recording_id} has no note: use append_note or replace_note.")
    markdown = note_to_markdown(stored, speakers)
    places = _places(markdown, old_text)
    if places == 0:
        raise NoteToolError(
            f"Text not found in the note of recording {recording_id}: copy it exactly from get_note, escapes included."
        )
    if places > 1:
        raise NoteToolError(
            f"Text appears {places} times in the note of recording {recording_id}: "
            "add surrounding text so it appears once."
        )
    return _with_hints(markdown_to_note(markdown.replace(old_text, new_text, 1), speakers))


def read_reply(recording_id: int, version: int | None, markdown: str | None) -> str:
    """What get_note answers: the version, then the Markdown edit_note matches against."""
    if version is None:
        return f"Recording {recording_id} has no note yet (version 0): add one with append_note or replace_note."
    return f"Note of recording {recording_id} (version {version}):\n\n{markdown}"


def reply(line: str, warnings: list[str]) -> str:
    """What a write answers: one line, then a line for each warning."""
    return "\n".join([line, *warnings])
