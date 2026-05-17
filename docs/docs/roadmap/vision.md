---
sidebar_position: 3
---

# Product Vision

Target state of the product as a whole. This document captures the full intended feature set and serves as the reference point for roadmap planning and architecture decisions.

---

## Overview

A local desktop application for transcribing meetings. Accepts audio and video files or records directly from the system. Identifies speakers across sessions, lets users correct and annotate the transcript, and maintains a persistent speaker memory that improves with every correction.

---

## 1. Recording Sources

Users should be able to get transcriptions from multiple input types:

- **File upload** — audio or video files from a recorded meeting.
- **Live recording** — captures both microphone input and system audio simultaneously.
- **Smart recording suggestions** — push notifications prompting the user to start recording when the system detects signs of a meeting: microphone is active, Zoom / Discord / browser is open, or there is an event in the calendar.
- **Dictation mode** — microphone-only recording for personal voice notes.

---

## 2. Transcript Management

### Editing
- Edit the text of individual segments.
- Reassign speakers manually; corrections must feed back into the speaker recognition system (via embeddings) so future sessions benefit.
- Edit the transcript title, timestamp, and tags.
- Delete the entire transcript or individual segments.

### Annotation
- Bookmark individual segments for quick access.
- Highlight a range of text and attach a note to it.
- Bookmark entire transcripts, with a dedicated section in the interface showing only saved recordings.

### Organisation
- Tag transcripts with user-defined labels (e.g. "1:1", "interview", "planning"). Tags are free-form and chosen by the user.
- Each transcript also carries an automatic **source type** tag that describes how it was created — this is set by the system and is not editable:

  | Source type | When assigned |
  |---|---|
  | `file` | Imported from an audio or video file |
  | `live-recording` | Captured via live recording (mic + system audio) |
  | `note` | Recorded in dictation mode (microphone only) |

  Source type is distinct from user tags and can be used independently for filtering.
- Automatically derive the transcript title from a linked calendar event when available.
- Unified search across meeting title, transcript text, and speakers — with label-style filtering similar to Slack.

### Export
- Export to clipboard or file.
- When exporting, map speaker IDs to alternative names (e.g. Slack handles).
- Automatically sync transcripts to a user-selected folder so they can be safely processed by external tools (e.g. Claude Code / Open Code).

---

## 3. Speakers

Speakers are a first-class entity in the application, not just string identifiers.

Users should be able to create, edit, and delete speakers. Each speaker has:

| Field | Description |
|---|---|
| First name | — |
| Last name | — |
| Alias | e.g. Slack handle (`@john`) |
| Colour | Fixed colour used throughout the UI |
| Avatar | Custom image instead of initials |

---

## 4. Settings

| Setting | Options |
|---|---|
| UI scale | Adjustable zoom level |
| Theme | Light / Dark |
| Recognition model | WhisperX (current); future: Whisper + separate diarisation system |
| Model size | Small / Medium / Large |
| Compute device | GPU / CPU |
| Model storage | Install models into the app folder instead of the system-wide cache |

---

## 5. CLI

The CLI is a non-interactive command-line tool for transcribing a recording from a script or terminal. No menus, no prompts — all options passed as flags.

**Basic usage:**
```bash
whisper_app /path/to/recording.wav /path/to/output.txt
```

**Flags:**
- Output format (e.g. plain text, JSON, SRT) — specified via flag.
- Print transcript to stdout — optional flag; silent by default.

**Behaviour:**
- Transcribes the recording, identifies speakers, and resolves them against speaker memory.
- Saves the result to the specified output file in the requested format.
- Also saves the transcript to the app's database, updating speaker memory and all related state — identical to what the GUI would do.
- If the output path is omitted, only stdout output is produced (requires the stdout flag).

The CLI shares all backend services with the GUI. It is not a separate pipeline — it is the same system accessed without a graphical interface.

---

## 6. Testing

Testing coverage should grow alongside the product. The intended approach:

- **Unit tests** — core business logic (services, models).
- **Integration tests** — key end-to-end scenarios.
- **E2E tests** — full pipeline tests through the Electron UI (or via the API).

---

## 7. Platform Support

The application should run on:

- macOS
- Windows
- Linux

Currently only tested on **Linux (Fedora)**. macOS and Windows compatibility needs to be verified separately before any release.

---

## 8. Packaging & Distribution

The application should be packaged as a native installable for each target platform:

- macOS — `.dmg` or `.pkg`
- Windows — `.exe` installer
- Linux — `.AppImage`, `.deb`, or `.rpm`

Goal: a user should be able to install and run the app without any knowledge of Python environments or dependencies.

---

## 9. Logging

The application should produce structured, human-readable logs that make it easy to understand what is happening at each stage — both during development and when diagnosing issues.

### What should be logged

**Pipeline steps** — each stage of the transcription pipeline should emit a log entry when it starts and when it finishes, including timing:

| Stage | Example log |
|---|---|
| Transcription | `[TranscriptionService] Transcribing audio: output.wav` |
| Embedding extraction | `[EmbeddingService] Extracting embeddings — 3 speakers, 27 segments` |
| Speaker resolution | `[SpeakerMemoryService] Resolving 3 speakers against 12 known profiles` |
| Transcript build | `[TranscriptBuilder] Built transcript: 27 segments` |
| Commit | `[CommitService] Committed 3 speakers to memory` |

**Database operations** — every read, write, update, and delete against the database should be logged with the table name and a minimal description of the affected records:

| Operation | Example log |
|---|---|
| Insert | `[DB] INSERT transcriptions id=42 audio=output.wav` |
| Insert segments | `[DB] INSERT segments 27 rows for transcription 42` |
| Update speaker | `[DB] UPDATE segments speaker_id=Alice where transcription=42 from=spk_a1b2` |
| Load transcript | `[DB] SELECT transcriptions id=42` |
| Load segments | `[DB] SELECT segments 27 rows for transcription 42` |

**Speaker memory** — reads from and writes to `speaker_memory.db` (embeddings, names):

| Operation | Example log |
|---|---|
| Load memory | `[SpeakerMemoryService] Loaded 12 known speakers` |
| Resolve match | `[SpeakerMemoryService] SPEAKER_00 → Alice (similarity 0.91)` |
| Resolve no match | `[SpeakerMemoryService] SPEAKER_01 → spk_a1b2 (new, best similarity 0.43)` |
| Save memory | `[SpeakerMemoryService] Saved 13 speakers` |

### Log levels

| Level | When used |
|---|---|
| `INFO` | Normal operation — pipeline steps, DB operations, speaker resolution |
| `DEBUG` | Verbose detail — per-segment timing, similarity scores, raw diarization output |
| `WARNING` | Recoverable unexpected state — e.g. embedding is None for a segment |
| `ERROR` | Failures that require attention |

### Visibility control

Logs are not shown in the GUI. The user controls logging at launch via environment variables or CLI flags, without changing any config file:

- **Environment variable** — `LOG_LEVEL=DEBUG` (or `INFO`, `WARNING`, `OFF`)
- **Environment variable** — `LOG_FILE=/path/to/app.log` — write logs to a file in addition to `stderr`
- **CLI flag** — `--log-level debug` (overrides `LOG_LEVEL`)
