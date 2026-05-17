---
sidebar_position: 4
---

# CLI

After transcription completes, the user enters an interactive main menu.

---

## Main menu

```
=== Transcript ===
[0] [00:00 - 00:04] Alice: Hello, how are you?
[1] [00:05 - 00:08] Bob: All good, thanks.
...

=== Menu ===
  [1] Edit segments
  [2] Edit speakers
  [3] Export transcript to text file
  [4] Save to database
  Enter — exit without saving
```

The transcript is displayed before the menu on every return to it.

---

## [1] Edit segments

Submenu for editing individual segments. Displays the transcript and waits for a segment number.

```
Select segment (Enter to go back):
```

After selecting a segment, the speaker assignment menu is shown:

```
=== Assign speaker ===
  [0] Alice  (uuid-...)
  [1] Bob    (uuid-...)
  [2] Carlos (uuid-...)  [db]
  [n] New speaker
  Enter — cancel
```

Speakers from the current recording are shown first. Speakers from the database not present in this recording are marked `[db]`.

After selecting a speaker, choose the scope:

```
  [1] All [Alice] segments
  Enter — this segment only
```

**`[n] New speaker`** — creates a new UUID4 ID, offers to enter a name.

---

## [2] Edit speakers

Speaker name management. Shows all speakers in the current session with their IDs:

```
=== Speakers in this session ===
  [0] uuid-...  →  Alice
  [1] uuid-...  →  uuid-...

Select speaker number:
Label (Enter for 'display'):
New name [display]:
```

Names are saved to `speaker_names` only after **[4] Save to database**.

---

## [3] Export transcript to text file

Exports the transcript to a `.txt` file. Creates the directory structure:

```
.files/
  YYYY-MM-DD/
    <audio_name>/
      <audio_name>.txt
      <audio_name>.wav
```

Date is taken at export time. The audio file is copied next to the transcript (not moved). If the audio file already exists in the destination, it is not overwritten.

Line format in `.txt`:
```
[MM:SS - MM:SS] Speaker: segment text
```

For recordings longer than one hour the timestamp format is `HH:MM:SS`.

---

## [4] Save to database

Saves the session result to `speaker_memory.db`:

1. **`CommitService.commit()`** — recomputes speaker embeddings in `speaker_embeddings`, saves names to `speaker_names`
2. **`TranscriptStorageService.save()`** — writes the transcription and segments to `transcriptions` / `segments`

---

## Enter — exit without saving

Exits the program without saving. All speaker and text changes are discarded.
