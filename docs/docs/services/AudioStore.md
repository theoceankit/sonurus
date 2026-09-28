---
sidebar_position: 7
---

# Audio Store

`app/services/audio_store.py` keeps every transcript's audio inside the app's data directory, so a transcript stays playable after the user moves or deletes the file they imported.

---

## Layout

All audio referenced by `transcriptions.audio_file` lives in `RECORDINGS_DIR` (`$SONORUS_DATA_DIR/recordings/`):

| File | Origin |
|---|---|
| `sonorus-rec-<uuid>.wav` / `.webm` | Live recording (capture service or renderer `MediaRecorder`) |
| `sonorus-import-<uuid>.<ext>` | Copy of an imported file; the extension is kept, lower-cased |

The user's original file is never modified or deleted.

---

## Functions

### `import_audio(src, recordings_dir) → str`

Copies `src` to `recordings_dir/sonorus-import-<uuid><ext>` (`shutil.copy2`, a symlink is followed) and returns the copy's path. A file already inside `recordings_dir` (a live recording) is returned unchanged. On `OSError` a partial copy is removed and the error is re-raised.

### `is_import_copy(path, recordings_dir) → bool`

`True` for a `sonorus-import-*` file inside `recordings_dir`.

### `discard_import(path, recordings_dir)`

Deletes an import copy. Live recordings and files outside `recordings_dir` are left alone.

### `discard_owned_audio(path, recordings_dir)`

Deletes any audio file inside `recordings_dir` — a live recording or an import copy — when its queued job is deleted. Files outside `recordings_dir` (the user's originals) are left alone; a symlink is removed as a link, its target is kept.

### `remove_orphan_imports(recordings_dir, referenced) → int`

Deletes `sonorus-import-*` files whose path is not in `referenced`. Live recordings are never removed — an unreferenced one is still the only copy of that recording. Returns the number of files removed.

---

## Lifecycle

| Moment | What happens |
|---|---|
| `POST /queue/jobs` | `import_audio()` runs before the job is queued, so the copy exists even if the original disappears while the job waits. A copy error returns `400` and no job is queued. |
| Job paused, interrupted or failed | The copy stays: the job runs again later or is retried. |
| Job saved | `transcriptions.audio_file` is the copy's path; the job leaves the queue. |
| `DELETE /queue/jobs/{id}` | `discard_owned_audio()` removes the job's audio — the copy or the live recording. |
| Backend startup | `remove_orphan_imports()` with the audio of all transcripts and all queued jobs removes copies nothing references (e.g. the backend stopped between copying and queuing). |
| `DELETE /transcripts/{id}` | The copy is removed like a live recording (`_delete_owned_recording`). |
| `POST /data/reset` | `recordings/` is emptied and the queue cleared. |
