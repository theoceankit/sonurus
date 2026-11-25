"""The MCP tools of the note of a recording: get_note reads it as Markdown;
append_note, replace_note and edit_note write it.

A write reads the note, changes it (app/mcp/note_changes.py) and stores it with
the version it read, as the agent's (writer kind mcp): the backend announces it
(note_changed) and an open editor merges it with what the user is typing. A
note changed between the read and the write is read again, ATTEMPTS times;
replace_note instead refuses a note changed since the version the agent read.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

from mcp.server.mcpserver import Context, MCPServer
from mcp_types import CallToolResult, TextContent
from pydantic import Field

from app.mcp.note_changes import (
    ATTEMPTS, NoteToolError, appended, changed_since, edited, is_empty, keeps_changing, not_found, read_reply, replaced,
    reply, same_note,
)
from app.services.note_markdown import NoteFromMarkdown, NoteSpeakers, note_to_markdown
from app.services.speaker_memory_service import SpeakerMemoryService
from app.services.transcript_storage_service import NoteVersionConflict, TranscriptStorageService
from app.services.transcript_text import note_speakers

RecordingId = Annotated[int, Field(description="The recording, by its recording_id from list_recordings.")]
Change = Callable[[dict | None, NoteSpeakers], NoteFromMarkdown]


def _answer(text: str, error: bool = False) -> CallToolResult:
    # Returned, not raised as ToolError: the SDK would put "Error executing tool
    # <name>:" before the line.
    return CallToolResult(content=[TextContent(type="text", text=text)], is_error=error)


def _writer(ctx: Context | None) -> dict:
    """The agent as the writer of the note: the client's name when this request
    carries it (a stateless call may not)."""
    name = None
    try:
        params = ctx.session.client_params if ctx is not None else None
        name = params.client_info.name if params is not None else None
    except Exception:
        name = None
    return {"kind": "mcp", "name": name}


def read_note(storage: TranscriptStorageService, memory: SpeakerMemoryService, recording_id: int) -> str:
    """The line get_note answers, with the note as Markdown."""
    if not storage.exists(recording_id):
        raise not_found(recording_id)
    note = storage.get_note(recording_id)
    if note is None:
        return read_reply(recording_id, None, None)
    return read_reply(recording_id, note["version"],
                      note_to_markdown(note["content"], note_speakers(storage, memory, recording_id)))


def write_note(storage: TranscriptStorageService, memory: SpeakerMemoryService, recording_id: int,
               change: Change, *, done: str, writer: dict, read_version: int | None = None,
               check_version: bool = False) -> str:
    """Reads, changes and stores the note; the line the tool answers. done: the
    verb of the answer ("Appended to"). check_version: refuse a note not at
    read_version (None: no note) rather than read it again."""
    if not storage.exists(recording_id):
        raise not_found(recording_id)
    for _ in range(ATTEMPTS):
        note = storage.get_note(recording_id)
        current = note["version"] if note else None
        if check_version and current != read_version:
            raise changed_since(recording_id, read_version, current)
        speakers = note_speakers(storage, memory, recording_id)
        stored = note["content"] if note else None
        result = change(stored, speakers)
        try:
            if is_empty(result.doc, speakers):
                if note is None:
                    return reply(f"Recording {recording_id} has no note, and the Markdown is empty: nothing was written.",
                                 result.warnings)
                storage.delete_note(recording_id, expected=current, writer=writer)
                return reply(f"The note of recording {recording_id} is now empty and was removed.", result.warnings)
            if stored is not None and same_note(stored, result.doc, speakers):
                return reply(f"The note of recording {recording_id} is unchanged (version {current}).", result.warnings)
            saved = storage.save_note(recording_id, result.doc, expected=current, writer=writer)
        except NoteVersionConflict as conflict:
            if check_version:
                raise changed_since(recording_id, read_version, conflict.current)
            continue
        if saved is None:
            raise not_found(recording_id)
        return reply(f"{done} the note of recording {recording_id} (version {saved['version']}).", result.warnings)
    raise keeps_changing(recording_id)


def register_note_tools(server: MCPServer, storage: Callable[[], TranscriptStorageService],
                        memory: Callable[[], SpeakerMemoryService]) -> None:
    """Adds the tools to the server; storage and memory give the services each call uses."""

    def run(recording_id: int, change: Change, ctx: Context | None, **options) -> CallToolResult:
        try:
            return _answer(write_note(storage(), memory(), recording_id, change, writer=_writer(ctx), **options))
        except NoteToolError as refusal:
            return _answer(str(refusal), error=True)

    @server.tool()
    def get_note(recording_id: RecordingId) -> CallToolResult:
        """Read the note of a recording as Markdown, with its version. The note editor's Markdown:
        headings, lists, checkboxes - [ ] / - [x], quotes, **bold**, *italic*, links; [12:34] is a
        timecode of the recording, @handle a speaker, @[Name] someone not in Sonorus. Pass the
        version to replace_note, and copy text from here for edit_note."""
        try:
            return _answer(read_note(storage(), memory(), recording_id))
        except NoteToolError as refusal:
            return _answer(str(refusal), error=True)

    @server.tool()
    def append_note(
        recording_id: RecordingId,
        markdown: Annotated[str, Field(description="Markdown to add at the end of the note.")],
        ctx: Context,
    ) -> CallToolResult:
        """Add Markdown at the end of the note of a recording; creates the note if there is none.
        The note editor's Markdown: headings #, ##, ###; lists, checkboxes - [ ] / - [x]; quotes >;
        **bold**, *italic*, [text](url). [12:34] is a timecode of the recording and @handle a speaker
        (handles from list_speakers); @[Name] mentions someone not in Sonorus. Anything else
        (tables, code, images) is made simpler and the answer says so. The note open in Sonorus
        shows the change at once, without losing what the user is typing."""
        return run(recording_id, lambda stored, speakers: appended(stored, markdown, speakers,
                                                                   recording_id=recording_id),
                   ctx, done="Appended to")

    @server.tool()
    def replace_note(
        recording_id: RecordingId,
        markdown: Annotated[str, Field(description="The whole new note, as Markdown. Empty removes the note.")],
        version: Annotated[int, Field(description="The version of the note get_note gave; 0 if it had no note.")],
        ctx: Context,
    ) -> CallToolResult:
        """Replace the whole note of a recording with Markdown (format as for append_note).
        Read the note with get_note first and pass its version: a note changed since, for
        example by the user, is not replaced. To change one place, use edit_note."""
        return run(recording_id, lambda stored, speakers: replaced(markdown, speakers), ctx,
                   done="Replaced", read_version=version or None, check_version=True)

    @server.tool()
    def edit_note(
        recording_id: RecordingId,
        old_text: Annotated[str, Field(description="Text to replace, exactly as get_note gives it, escapes included; "
                                                   "it must appear in the note once.")],
        new_text: Annotated[str, Field(description="Markdown to put in its place; empty removes the text.")],
        ctx: Context,
    ) -> CallToolResult:
        """Replace one place in the note of a recording: old_text, copied from get_note's
        Markdown and found there exactly once, becomes new_text (format as for append_note).
        Text found nowhere or more than once is refused; add surrounding text to make it unique."""
        return run(recording_id, lambda stored, speakers: edited(stored, old_text, new_text, speakers,
                                                                 recording_id=recording_id),
                   ctx, done="Edited")
