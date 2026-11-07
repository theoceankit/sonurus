---
sidebar_position: 8
---

# New UI home

What the new UI shows before the user picks anything: which recording is open when the app starts, and after the open one is deleted.

## Which recording is open

With recordings in the list, one is always open. `EditorScreen` picks one whenever none is: when the list first loads and after the open recording is deleted. It waits for the list; while the list loads or the backend does not answer, nothing is picked.

The pick is `pickRecording(list, recent)` in `ui/src/screens/Home/last-opened.ts`, a pure function:

1. The last recording opened that is still in the list.
2. Otherwise the one opened before it, and so on down the list of recent ones.
3. With none of them left, the newest recording, which comes first in `GET /transcripts`.

So after a delete the recording opened before the deleted one opens, not its neighbour in the sidebar. The neighbour could not be known at startup anyway, if a recording was deleted while the app was closed.

`useRecentRecordings()` keeps the recent ones in Electron's `settings.json` as `recentTranscriptIds`: up to 20 ids, newest first. A recording goes first when it opens, whether the user clicked it or it was picked. Each write reads the file first and changes only this field, one write at a time, as the old UI shares the file and keeps its own fields there. The old UI does not read the field and carries it along on its own writes, Reset to defaults included. Without Electron, in Storybook and tests, the list starts empty and lives in memory.

The backend is not involved: what was opened last is a setting of the interface, not data of a recording.
