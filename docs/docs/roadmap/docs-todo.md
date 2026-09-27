---
sidebar_position: 2
---

# Documentation TODO

What is still missing or needs updating in the docs.

---

## Missing

### `environment/setup.md`
Currently a placeholder. Needs full content: Python 3.11+ installation, virtual environment setup, HuggingFace token, first run for GUI and CLI.

---

## Needs updating

### Services (`docs/services/`)
Seven service docs exist but are in Russian and predate the current doc format. Each needs to be translated to English and updated to include Current State, Limitations, and Target State sections per our format.

| File | Status |
|---|---|
| `CommitService.md` | Russian, old format |
| `EmbeddingService.md` | Russian, old format |
| `SpeakerMemoryService.md` | Russian, old format |
| `TranscriptBuilder.md` | Russian, old format |
| `TranscriptionService.md` | Russian, old format |
| `TranscriptStorageService.md` | Russian, old format |
| `ArchiveService.md` | Russian, old format |

### `data-models.md`
Documents `Transcript` and `Segment` dataclasses. Needs translation to English and alignment with the speaker identity state machine described in [State Machines → Segment: Speaker Identity](../system/state-machine.md#4-segment-speaker-identity).

### `controllers/TranscriptionController.md`
Needs translation to English and a review for accuracy against current code.

