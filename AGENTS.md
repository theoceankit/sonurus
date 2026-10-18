# AGENTS.md

Instructions for AI coding agents working in this repository. Human contributors: start with
[CONTRIBUTING.md](CONTRIBUTING.md) — everything here is also true for you.

Sonorus is a local desktop app: an Electron UI (vanilla JS, no framework) over a FastAPI backend that
transcribes audio with WhisperX, diarizes with PyAnnote and remembers speakers across recordings in
SQLite. Everything runs on the user's machine; the app makes no network requests besides the ones
listed in `docs/docs/privacy.md`.

## Setup

Python 3.12, Node.js 22.12+, ffmpeg. Full steps: `docs/docs/environment/setup.md` → Developer setup.

```bash
python3.12 -m venv .venv
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128  # or the CPU index
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_nltk_data.py   # NLTK punkt_tab into .venv/nltk_data; the app never downloads it
npm ci
```

Transcribing needs a HuggingFace token with access to the gated PyAnnote models: `npm start` takes it
from Settings → API Keys, a backend started with uvicorn from `HF_TOKEN` in `.env` (see `.env.example`).

Unit tests need none of the ML libraries or a token — see [Tests](#tests).

## Commands

```bash
# Electron app. Starts the backend itself (electron/backend.js) unless a dev backend already answers on :8000.
# Data dir is Electron userData: ~/.config/sonorus-dev in dev, ~/.config/sonorus packaged.
npm start

# Backend alone. Data dir = $SONORUS_DATA_DIR or the current directory. Never add --reload.
.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000

# Docs site (Docusaurus, served at site root: docs/docs/intro.md → /intro)
cd docs && npm ci && npx docusaurus start   # dev server on :3000
cd docs && npx docusaurus build             # fails on broken links; must stay warning-free

# Packaged dependencies: edit requirements.packaged.txt, then regenerate and commit the locks (needs uv)
node scripts/lock-backend.js
node scripts/check-bundled-imports.js       # after node scripts/bundle-backend.js
```

There is no linter, formatter or type checker. Match the style of the surrounding code.

## Tests

```bash
.venv/bin/python -m pytest tests/ -v            # Python; HF Hub network is stubbed in tests/conftest.py
node --test 'tests/renderer/*.test.js'          # renderer units (node:test, scripts loaded via node:vm)
node --test 'tests/build/*.test.js'             # lock files, installer size, no first-run setup
SONORUS_QUALITY=1 .venv/bin/python -m pytest tests/quality -v -s   # real models on AMI clips, opt-in
```

- CI (`.github/workflows/tests.yml`) installs only `requirements-test.txt`. `tests/conftest.py` replaces
  torch, WhisperX, PyAnnote and `huggingface_hub` with `MagicMock` stubs — in the parent process only.
  Worker functions for spawned child processes therefore live in `tests/download_workers.py` and
  `tests/pipeline_workers.py`, which import no app code. Reproduce CI in a venv with just
  `requirements-test.txt` (`docs/docs/testing/overview.md` → CI environment).
- Every test gets a paused transcription queue on a temporary database; no test may touch real data.
- Quality tests: `docs/docs/testing/quality.md`.

## Verifying UI changes

Tests do not cover layout. Check UI changes in the running app with Playwright's `_electron` against an
isolated backend and profile — never against real user data:

```bash
SONORUS_DATA_DIR=<tmp> .venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
npx electron . --user-data-dir=<tmp>
```

Seed the data before starting, and check every affected row and state, not just the first one.

## Architecture

```
POST /queue/jobs → copy imported audio into recordings/ → queue worker → child process:
  transcribe → extract_all (embeddings) → resolve (pure) → build transcript → attach embeddings
→ save + commit (the only write to speaker memory) → [user review in the editor]
```

| Area | Where | Docs |
|---|---|---|
| REST + WebSocket API | `app/api/main.py`, `app/api/routers/`, `app/api/schemas.py` | `docs/docs/api/endpoints.md` |
| Services | `app/services/`; all constructed by `service_factory.create_controller()` | `docs/docs/services/` |
| Queue and pipeline | `transcription_queue.py`, `transcription_job.py`, `pipeline_process.py` | `docs/docs/services/TranscriptionQueue.md`, `PipelineProcess.md` |
| Data model and DB schema | `app/models/`, `TranscriptStorageService`, `SpeakerMemoryService`, `JobStore` | `docs/docs/data-models.md` |
| Lifecycles and invariants | — | `docs/docs/system/state-machine.md`, `docs/docs/system/invariants.md` |
| Config and environment | `app/config.py`, `.env` | `docs/docs/environment/configuration.md` |
| Electron main process | `electron/main.js`, `backend.js`, `backend-identity.js`, `gpu-pack.js`, `preload.js` | `docs/docs/ui/electron/overview.md` |
| Renderer | `electron/renderer/app.js`, `views/`, shared helpers in `utils.js` | `docs/docs/ui/electron/` |
| Live recording | `app/api/routers/audio_capture.py`, `native/` | `docs/docs/ui/electron/live-recording.md` |
| Packaging and releases | `scripts/bundle-backend.js`, `locks/`, `build/` | `docs/docs/distribution/` |

## Rules that must hold

Domain rules (details in `docs/docs/system/invariants.md`):

1. **`resolve()` is pure.** `SpeakerMemoryService.resolve()` never mutates `known_speakers`; it only
   returns a `{SPEAKER_XX → id}` mapping.
2. **Only `CommitService` writes speaker memory**, via `SpeakerMemoryService.update_embedding()`. No
   other code calls `memory_service.save()` or modifies `known_speakers`. Sole exception:
   `SpeakerMemoryService.clear()` in `POST /data/reset`, after all segments are deleted.
3. **Effective speaker:** `UNASSIGNED` if `seg.unassigned`, else `speaker_final ?? speaker_resolved ??
   speaker_raw`. `speaker_final` (the user's correction) always wins over automatic results.
4. **Recompute embeddings from the DB, never increment.** Every `CommitService` method averages from
   `storage.get_embeddings_grouped_by_transcript(spk_id)` from scratch.
5. **Speaker ids are UUID4, never display names.** Names live only in `speaker_names`; a speaker
   without a display name is unrecognized. Names need not be unique.

App rules:

- The backend is the only writer of `recordings/`. The renderer uploads recordings to
  `POST /audio/recordings`; Electron writes no audio.
- Dev and packaged data stay apart (`electron/backend-identity.js`); never point dev work at
  `~/.config/sonorus`.
- No new network requests. Anything that contacts a server must be listed in `docs/docs/privacy.md`;
  third-party telemetry stays forced off (`app/__init__.py`).
- Icons are SVG files in `electron/assets/icons/`, used through `icons.js`; no inline SVG icons.
  Speaker initials are drawn only by the avatar helpers in `utils.js`. Renderer tests enforce both.
- A control whose feature does not exist yet is marked with `markNotImplemented()`
  (`electron/renderer/not-implemented.js`) — never hidden and never faked. When the feature lands,
  remove its id and the call.
- UI text: no `·` separators, no all-caps labels.

## Workflow

- **Bug fixes are test-first:** a failing test that reproduces the bug, then the fix, then the full
  suite (Python, renderer and, if relevant, build tests).
- **One logical change per commit.** Conventional commits with a scope, as in `git log`:
  `fix(capture): …`, `feat(api): …`, `docs: …`, `refactor(renderer): …`, `test: …`. The body says
  why, not what.
- **Branches:** `type/kebab-case` (`fix/…`, `feat/…`, `docs/…`). Never commit to `main` directly.
- **Docs:** English. A behavior change updates the matching page in `docs/docs/` in the same
  change. Docs describe how the system works; planned work, open bugs and ideas do not go in
  `docs/` — known limitations with workarounds go in `docs/docs/known-issues.md`.
- **Never commit** `.env`, `opencode.json` or other local tool configs, model weights, recordings or
  databases.
