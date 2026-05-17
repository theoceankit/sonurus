---
sidebar_position: 7
---

# Archive Service

`ArchiveService` saves the audio file and a plain-text transcript to `.files/YYYY-MM-DD/<stem>/` after the pipeline completes.

Used by both the CLI and the Electron UI — single implementation, no duplication.

---

## Directory structure

```
.files/
  2026-05-02/
    output/
      output.wav        ← audio copy
      output.txt        ← transcript in plain text
  2026-05-03/
    interview/
      interview.mp3
      interview.txt
```

The date is taken at the time `archive()` is called. The audio file is copied, not moved. If the audio is already in the destination directory, the copy is skipped.

---

## `.txt` format

```
[00:00 - 00:04] Alice: Hello, how are you?
[00:05 - 00:08] Bob: All good, thanks.
```

Timestamp: `MM:SS` (up to one hour) or `HH:MM:SS` (longer).

Speaker name is the result of `display_fn(spk_id)`. Defaults to the raw ID.

---

## Methods

### `archive(transcript, display_fn=None) → str`

Creates the directory, copies audio, writes `.txt`. Returns the destination directory path.

**Parameters:**
- `transcript` — a `Transcript` object with `audio_path` and `segments`
- `display_fn` — `Callable[[str], str]` to convert `spk_id` to a display name. If `None`, the identity function is used (ID as-is)

**Examples:**

```python
# Electron UI: raw speaker IDs (spk_xxx)
ArchiveService().archive(transcript)

# CLI: via controller's display_fn
ArchiveService().archive(transcript, display_fn=controller.get_display_name)
```

---

### `format_time(seconds) → str`  *(module-level function)*

Formats seconds into a timestamp string.

```python
format_time(65)    # → "01:05"
format_time(3661)  # → "01:01:01"
```

Used inside `archive()` and available for direct import.

---

## Position in the pipeline

```
TranscriptStorageService.save(transcript)
    ↓
ArchiveService.archive(transcript)
    ↓
.files/YYYY-MM-DD/<stem>/
    ├── audio.wav
    └── audio.txt
```

**CLI:** called manually via menu option [3] Export.

**Electron (via API):** called automatically in the `/transcribe` router after saving to the database — audio is copied and `.txt` is written with current speaker IDs.
