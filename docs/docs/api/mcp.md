---
sidebar_position: 2
---

# MCP server

The backend serves an [MCP](https://modelcontextprotocol.io) endpoint for agents on the same computer, such as Claude Code: they read the user's recordings through it and write their notes. It is off until the user turns it on in Settings → Integrations ([Settings](../ui/electron/settings.md#integrations)).

| | |
|---|---|
| Address | `http://127.0.0.1:8000/mcp` |
| Transport | Streamable HTTP, without sessions (`stateless_http`), answers as JSON (`json_response`): no SSE stream, no state between requests |
| Code | `app/mcp/server.py` (endpoint, server), `app/mcp/tools.py` (what every tool shares: times, the limit, refusals), `app/mcp/read_tools.py` and `read_format.py` (recordings, speakers, transcripts, search), `app/mcp/note_tools.py` and `note_changes.py` (the note), mounted in `app/api/main.py` |
| Library | The official Python SDK, `mcp` (`MCPServer`) |

The endpoint runs inside the backend, so it answers while Sonorus runs, also with its window closed to the tray, and not when Sonorus is quit. There is no process of its own.

## Connecting Claude Code

```bash
claude mcp add --transport http --scope user sonorus http://127.0.0.1:8000/mcp
```

`--scope user` makes Sonorus available to Claude Code in every project. Settings → Integrations shows the address and this command, with Copy, while the server is on.

The backend has one port, 8000: a development backend and the installed app's are on the same address, and an agent reaches whichever runs.

## On and off

The switch is a setting of the backend, `mcp_enabled` in [AppSettings](../services/AppSettings.md), read and written with `GET`/`PUT /integrations/mcp` ([API Endpoints](endpoints.md#integrations)). It is off on a new installation.

While it is off, `/mcp` answers `404` as a path that does not exist; the backend need not restart for either change, as `McpEndpoint` asks the setting on every request (from memory). Reset preferences and Delete all data turn it off.

`/mcp` is not a REST route: it is not in `/openapi.json`, and the UI never calls it.

## Other sites and host names

The SDK's guard against DNS rebinding is on (`SECURITY` in `app/mcp/server.py`):

- a request with an `Origin` other than `http://127.0.0.1:*`, `http://localhost:*` or `http://[::1]:*` — a page of another site in a browser — is refused with `403`;
- a request with a `Host` other than `127.0.0.1:*`, `localhost:*` or `[::1]:*` — a name of another site that resolves to this computer — is refused with `421`.

Agents such as Claude Code send no `Origin` and are let in.

## Lifespan

The SDK runs each request in a task group that `StreamableHTTPSessionManager.run()` holds open. The app lifespan enters `mcp_endpoint.running()`, which makes a new session manager each time (a manager runs once). Until the lifespan has started, `/mcp` answers `404`.

## Tools

Tools take and give recordings by `recording_id` (the transcript id), times in a recording as `mm:ss` or `h:mm:ss`, dates as `YYYY-MM-DD` in local time. Their descriptions and messages are in English; the content of recordings is as it is. A tool reads the data through the same services as the REST API.

| Tool | Answers |
|---|---|
| `list_recordings` | Recordings, newest first, one line each: `- recording_id 42: Weekly sync, 2026-11-20, 1:02:13, @anna @ivan, 2 unknown speakers, has note`. Filters: `speaker` (a handle), `date_from`, `date_to`; pages of `limit` (50, at most 200) from `offset`. |
| `list_speakers` | The speakers with a name, by name: `- Anna Petrova @anna: 14 recordings, 3:12:40 talk time, last 2026-11-20`, and how many voices without a name are left out. |
| `get_transcript` | The transcript of a recording as Copy transcript gives it, under a header; too long, contents by time; with `start` and `end`, a part. |
| `search` | Hits of the search of the backend, by recording, matches in `**bold**`. |
| `get_note` | The note of a recording: `Note of recording 7 (version 12):`, an empty line, then the note as Markdown. Without a note: `Recording 7 has no note yet (version 0): …`. |
| `append_note` | Adds Markdown at the end of the note, or makes it the note when there is none. |
| `replace_note` | Replaces the whole note with Markdown, given the `version` `get_note` read (`0`: no note). |
| `edit_note` | Replaces one place in the note: `old_text`, found exactly once in the Markdown `get_note` gives, becomes `new_text`. |

A recording is given by `recording_id`, a speaker by `@handle` (with or without `@`, in any case); speaker ids never reach the agent. A time in a recording is taken as `mm:ss`, `h:mm:ss` or seconds (`parse_clock()`). No answer is longer than 40,000 characters (`MAX_CHARS`): Claude Code warns of a tool answer from about 10,000 tokens and cuts it at 25,000. The tools keep within it themselves; `fit()` cuts what is left at a line, saying how many lines it left out.

A refusal is one line, what happened and what to do, as an error result of the tool (`isError`): `Recording 9 not found: use list_recordings to see recording_ids.` The tools return it rather than raise `ToolError`, which the SDK would give with `Error executing tool <name>:` before it.

### Recordings and speakers

`list_recordings` reads `list_all()` and `recording_speakers()` of [TranscriptStorageService](../services/TranscriptStorageService.md): the speakers of a recording are its effective speakers in the order they first speak, unassigned segments and recordings without speakers left out. Those with a name are written by handle; the others, voices with no name and labels of diarization that memory did not match, are counted as unknown speakers. A recording matches `speaker` when that speaker speaks in it, and the dates by the day of `created_at`, which is local time. The handle and the dates are checked as [search](../services/SearchService.md) checks them, with the same messages, except an unknown handle, which points to `list_speakers`. With no match: `No recordings match: widen the dates or leave out the speaker.` A page that is not all of them says which ones it shows, `340 recordings, newest first; 51–100 shown:`, and ends with the `offset` of the next.

`list_speakers` lists the speakers of `GET /speakers` that have a name, with the recordings they speak in, their talk time and the day they last spoke (`speaker_stats()`). One with no recordings yet says so. A speaker without a name has no handle and a label of its own in each recording, so they are only counted, in a closing line.

### The transcript

`get_transcript` builds the turns and text of the Editor on the backend ([Transcript Text](../services/TranscriptText.md)), so the agent reads the labels the user sees: `Unknown speaker 1`, `Unassigned`. Its answer starts with a header, then Copy transcript without its title line:

```
Weekly sync
recording_id 42, 2026-11-20 14:05, 1:02:13
Speakers: Anna Petrova @anna, Ivan Sidorov @ivan, Unknown speaker 1

Anna Petrova 00:12
Good morning, everyone.
```

The speakers are in the order they first speak, named ones with their handle; a recording without speakers has no `Speakers:` line and no turn headers.

**Whole or contents.** Without `start` and `end`, a transcript that fits in `MAX_CHARS` with its header comes whole. A longer one comes as contents, in parts of about 5 minutes (`chunks()`): a part ends at the first turn that starts 5 minutes or more after the part's start, so it holds whole turns; a turn longer than 7:30, a monologue or a recording without speakers, is first cut between its segments into pieces of about 5 minutes. Under the header:

```
Too long to return whole (61,240 chars). Read a part with get_transcript(recording_id=42, start="00:00", end="05:00").

Contents, in parts of about 5 minutes:
- 00:00–04:50, Anna Petrova, Ivan Sidorov (3,125 chars): "Good morning, everyone. Let's start with…"
```

A line has the time from the part's first segment to the end of its last, its speakers, the characters of its text and its first words, up to 100 characters.

**A part.** With `start` and/or `end`, the answer is the segments that start from `start` to before `end`, compared in whole seconds (a segment at 05:02.4 is in a part from `05:02`), so that a part read from the time of the contents misses nothing. Without `end` it reads to the end, without `start` from the start; the header has a line `Part 05:00–10:00`. A turn that starts before `start` repeats its speaker at its first segment in the part; labels of speakers without a name are those of the whole recording. A part that does not fit is cut before a turn, or between the segments of a turn if not even that one fits, and its last line says where to go on: `Cut at 34:10: call get_transcript with start=34:10 to read on.` (with the `end` asked, if any). No speech in the part: `No speech starts between 01:40 and 03:20.` An end not after the start and a start at or after the end of the recording are refused: `Recording 42 is 1:02:13 long: give a start before 1:02:13.`

### Search

`search` takes the parameters of [`GET /search`](endpoints.md#get-search), `query`, `speaker`, `date_from`, `date_to`, `recording_id`, `limit` (10 recordings, at most 50) and `offset`, and runs `SearchService.search()` with 3 hits a recording, 20 with `recording_id`, where `offset` pages through the hits of that recording. Its description explains the query language. The answer:

```
34 hits in 7 recordings, newest first:

recording_id 42: Weekly sync, 2026-11-20 (5 hits)
  title: **Release** planning
  12:34 Anna Petrova @anna: …we moved the **release** to Friday…
  note: …the **release** checklist
  2 more: call search with recording_id=42.

Speakers whose name or handle matches: Anna Petrova @anna. To search what one said, give speaker="@anna".
```

A snippet is on one line. A hit of a speaker without a name has the label of its recording: the tool loads the segments of those recordings on the page that have such a hit. More recordings or more hits than shown end with the `offset` to read on. Errors of the query and filters are the messages of `SearchQueryError` and `SearchRefused`.

### The note

The note is written and read as the Markdown of [Note Markdown](../services/NoteMarkdown.md): `[12:34]` is a timecode and `@handle` a speaker of the base, chips in the editor; `@[Name]` someone not in the base, `@[Unknown speaker 2]` a speaker of this recording without a name. Who can be mentioned comes from `note_speakers()` in `app/services/transcript_text.py`: every speaker of the base, and this recording's speakers without a name by the label the editor shows (`unknown_speaker_names()`, a port of `unknownSpeakerNames` in the UI).

A write never refuses Markdown: what the note does not have is made simpler, an unknown handle stays text, and the converter's warnings follow the answer, one line each; the one about handles adds where to find them (`list_speakers`) and `@[Name]`.

- `append_note` puts the new blocks after the note's own, which stay as stored, empty lines at the edges of the new text left out. Empty Markdown is refused.
- `replace_note` refuses a note that is not at `version`: `The note of recording 7 changed since version 12 (now version 13): read it with get_note and replace again.` So an agent replaces only what it read, and what the user saved meanwhile is kept.
- `edit_note` matches `old_text` against the Markdown character for character, escapes included, and counts overlapping places. Not found, found more than once, an empty `old_text` and a recording without a note are refused, each with what to do. An empty `new_text` removes the text. The whole note is then written back from its Markdown, in [its normal form](../services/NoteMarkdown.md#without-loss).

Each write reads the note, changes it and stores it with the version it read (`save_note`/`delete_note` with `expected`), as `writer` `{kind: "mcp", name}`, `name` being the client's own (`clientInfo`), when the request carries it. The backend announces it (`note_changed`) and an open editor merges it with what the user is typing ([Notes](../ui/electron/notes.md#changes-from-elsewhere)). A note saved by someone else between the read and the write is read again, up to 3 times (`ATTEMPTS`), then: `The note of recording 7 keeps changing while it is written: try again in a moment.` `replace_note` is not tried again: the version is the agent's.

A write answers one line with the version it made: `Appended to the note of recording 7 (version 13).`, `Replaced …`, `Edited …`. A note that would read back the same is not written: `The note of recording 7 is unchanged (version 12).` A note left empty is deleted, as the editor does: `The note of recording 7 is now empty and was removed.`

## Network

The server makes no requests of its own. The SDK brings `opentelemetry-api`, which sends nothing without an OpenTelemetry SDK, and that is off ([Privacy](../privacy.md#third-party-telemetry)). What an agent does with what it reads is up to the agent: see [Privacy](../privacy.md#agents-connected-over-mcp).
