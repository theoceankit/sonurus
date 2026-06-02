---
sidebar_position: 7
---

# Archive Service

`ArchiveService` saves the audio file and a plain-text transcript after the pipeline completes.

---

## Archive location

Files are written to `$SONORUS_DATA_DIR/.files/YYYY-MM-DD/<stem>/`.

`SONORUS_DATA_DIR` is set automatically by Electron to `app.getPath('userData')`:

| Platform | Full path |
|---|---|
| macOS | `~/Library/Application Support/Sonorus/.files/` |
| Windows | `%APPDATA%\Sonorus\.files\` |
| Linux | `~/.config/Sonorus/.files\` |

In dev mode without `SONORUS_DATA_DIR` set, defaults to `./.files/` in the working directory.

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

The date is taken at the time `archive()` is called. The audio file is copied, not moved. If the audio is already at the destination, the copy is skipped.

---

## `.txt` format

```
[00:00 - 00:04] Alice: Hello, how are you?
[00:05 - 00:08] Bob: All good, thanks.
```

Timestamp: `MM:SS` (up to one hour) or `HH:MM:SS` (longer). Speaker name is the result of `display_fn(spk_id)`, defaulting to the raw ID.

---

## Methods

### `archive(transcript, display_fn=None) → str`

Creates the directory, copies audio, writes `.txt`. Returns the destination directory path.

| Parameter | Description |
|---|---|
| `transcript` | `Transcript` object with `audio_path` and `segments` |
| `display_fn` | `Callable[[str], str]` to convert `spk_id` to a display name |

---

### `format_time(seconds) → str`

```python
format_time(65)    # → "01:05"
format_time(3661)  # → "01:01:01"
```

---

## Position in the pipeline

```
TranscriptStorageService.save(transcript)
    ↓
ArchiveService.archive(transcript)
    ↓
$SONORUS_DATA_DIR/.files/YYYY-MM-DD/<stem>/
    ├── audio.wav
    └── audio.txt
```

Called automatically in the `/transcribe` router after saving to the database.
