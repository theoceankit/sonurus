---
sidebar_position: 17
---

# Transcript Text

`app/services/transcript_text.py` builds a recording as the Editor shows it, for tools that give it out as text: the [MCP server](../api/mcp.md) gives an agent the transcript the user copies, with the same labels. It holds ports of the UI's functions, pure, with no database, and one helper over the services.

| Python | UI | What it is |
|---|---|---|
| `effective_speaker(segment)` | `effectiveSpeaker` (`ui/src/api/types.ts`) | `UNASSIGNED` for an unassigned segment, else `speaker_final`, `speaker_resolved`, `speaker_raw` ([invariant 3](../system/invariants.md)) |
| `unknown_speaker_names(segments, named)` | `unknownSpeakerNames` (`ui/src/screens/Editor/transcript.ts`) | `{speaker id: "Unknown speaker N"}` for the speakers not in `named`, numbered in the order they first speak |
| `build_turns(segments, speakers)` | `buildTurns` | Neighbouring segments of one speaker as a `Turn(speaker, start, segments)`; `TurnSpeaker(id, kind, name, handle)` is `named`, `unknown` (a speaker without a name, or not among `speakers`) or `unassigned` (`Unassigned`) |
| `transcript_text(title, turns, diarized)` | `transcriptText` | The text of Copy transcript: the title, then each turn, apart by an empty line |
| `turn_block(turn, diarized)` | (inside `transcriptText`) | One turn: `Name mm:ss` over a line per paragraph; the paragraphs alone without speakers |
| `clock(seconds)` | `formatClock` (`ui/src/media/timeline.ts`) | `mm:ss` under an hour, `h:mm:ss` from an hour on, whole seconds rounded down |

Colours and photos of the UI's turns are left out: text has none. `note_speakers(storage, memory, recording_id)` gives the speakers a note of the recording can mention ([MCP server](../api/mcp.md#the-note)).

## Fixtures

The two must give the same text, so both are checked against `tests/fixtures/transcript/`: each `<case>.json` holds a recording (`title`, `diarized`, `speakers` with `id`, `name`, `handle`, and `segments` as `GET /transcripts/{id}` gives them), each `<case>.txt` its text. The cases: named speakers, speakers without a name and ones not in the base, unassigned segments, the user's speaker over the matched one over diarization, a recording without speakers, times from an hour on, Cyrillic, no segments.

The Editor is the reference. `ui/src/screens/Editor/transcript-fixtures.test.ts` builds each text with `buildTurns` and `transcriptText`; with `TRANSCRIPT_FIXTURES=write` it writes the `.txt` files instead of checking them. `tests/test_transcript_text.py` checks the Python port against the same files. A change to Copy transcript in the UI fails the UI test until the files are written again, and then the Python test until the port follows.

```bash
cd ui && TRANSCRIPT_FIXTURES=write npx vitest run src/screens/Editor/transcript-fixtures.test.ts
```
