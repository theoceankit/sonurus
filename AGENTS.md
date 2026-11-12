# AGENTS.md

Instructions for AI coding agents working in this repository. Human contributors: start with
[CONTRIBUTING.md](CONTRIBUTING.md) — everything here is also true for you.

Sonorus is a local desktop app: an Electron window with a React and TypeScript UI (`ui/`) over a FastAPI backend that
transcribes audio with WhisperX, diarizes with PyAnnote and remembers speakers across recordings in
SQLite. Everything runs on the user's machine; the app makes no network requests besides the ones
listed in `docs/docs/privacy.md`.

## Setup

Python 3.12, Node.js 22.22.2+, ffmpeg. Full steps: `docs/docs/environment/setup.md` → Developer setup.

```bash
python3.12 -m venv .venv
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128  # or the CPU index
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_nltk_data.py   # NLTK punkt_tab into .venv/nltk_data; the app never downloads it
npm ci
npm --prefix ui ci && npm run build:ui
```

Transcribing needs a HuggingFace token with access to the gated PyAnnote models: `npm start` takes it
from Settings → API Keys, a backend started with uvicorn from `HF_TOKEN` in `.env` (see `.env.example`).

Unit tests need none of the ML libraries or a token — see [Tests](#tests).

## Commands

```bash
# UI (ui/, own package, Node.js 22.22.2+): install once and build; npm start loads the build in ui/dist.
npm --prefix ui ci
npm run build:ui

# Electron app. Starts the backend itself (electron/backend.js) unless a dev backend already answers on :8000.
# Data dir is Electron userData: ~/.config/sonorus-dev in dev, ~/.config/sonorus packaged.
npm start
npm run dev:ui                              # Vite + Electron with hot reload instead of the build
npm --prefix ui run storybook               # http://localhost:6006, telemetry off

# API schema and types of the UI, after any change to a route or schema (generator: once npm --prefix ui/tools/openapi-types ci)
npm run gen:api

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
node --test 'tests/electron/*.test.js'          # Electron main process (node:test)
node --test 'tests/build/*.test.js'             # lock files, installer size, no first-run setup, UI packaging
npm --prefix ui test                            # UI units (Vitest, Testing Library)
npm --prefix ui run typecheck
npm run test:e2e                                # built app end to end on seeded data (needs ui/dist, port 8000 free)
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
isolated backend and profile — never against real user data. `tests/e2e/harness.js` does it for a script
(`startApp()`), or by hand:

```bash
PYTHONPATH=. SONORUS_DATA_DIR=<tmp> .venv/bin/python tests/e2e/seed.py   # or a seed of your own
SONORUS_DATA_DIR=<tmp> .venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
npx electron . --user-data-dir=<tmp>
```

Seed the data before starting, and check every affected row and state, not just the first one.
Dev server origin, restarts, worktrees, jsdom and Playwright pitfalls: `docs/docs/ui/electron/development.md`.

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
| UI | `ui/`, screens in `ui/src/screens/`, what the window loads in `electron/ui-entry.js`, its frame in `electron/window-chrome.js` | `docs/docs/ui/electron/overview.md` |
| Data: API client, fixtures, generated types | `ui/src/api/`, `ui/src/platform/`, `ui/tools/openapi-types/`, `app/api/openapi_schema.py` | `docs/docs/ui/electron/data.md` |
| Player and playback | `ui/src/media/`, `ui/src/components/Player/`, `ui/src/screens/Editor/EditorPlayer.tsx` | `docs/docs/ui/electron/player.md` |
| Transcript | `ui/src/screens/Editor/Transcript*.tsx`, `transcript.ts`, `ui/src/media/active-segment.ts`, `ui/src/components/TurnHeader/`, `Paragraph/`, `TranscriptHeader/`, `SpeakerMenu/` | `docs/docs/ui/electron/transcript.md` |
| Inspector and speaker review | `ui/src/screens/Editor/InspectorPanel.tsx`, `SpeakerDialogs.tsx`, `review-queue.ts`, `inspector.ts`, `speaker-search.ts`, `new-speaker.ts`, `ui/src/media/clip-playback.ts` | `docs/docs/ui/electron/inspector.md` |
| Home: the recording open at startup, empty state, New recording and Import files dialogs, file drops | `ui/src/screens/Home/`, `ui/src/components/DropZone/` | `docs/docs/ui/electron/home.md` |
| Transcription: models, the default model, downloads, languages, the queue in the sidebar, the Alignment model and job settings dialogs | `ui/src/transcribe/`, `ui/src/screens/Queue/` | `docs/docs/ui/electron/transcribe.md` |
| Settings: the Settings dialog, its sections and what they change | `ui/src/screens/Settings/`, `ui/src/platform/settings.ts` | `docs/docs/ui/electron/settings.md` |
| Speakers: the Speakers window, a speaker's card, voice samples from any recording | `ui/src/screens/Speakers/`, `ui/src/media/sample-playback.ts`, `ui/src/components/AppearanceRow/` | `docs/docs/ui/electron/speakers.md` |
| Tokens, font, icons, overlays | `ui/src/styles/`, `ui/src/assets/`, `ui/src/components/` | `docs/docs/ui/electron/foundations.md` |
| Development: data, isolated checks, restarts, test pitfalls | `scripts/dev-ui.js`, `ui/vite.config.ts`, `ui/src/test-setup.ts` | `docs/docs/ui/electron/development.md` |
| Live recording | `app/api/routers/audio_capture.py`, `native/`, `ui/src/recording/` | `docs/docs/ui/electron/live-recording.md` |
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

- The backend is the only writer of `recordings/`. The UI uploads recordings to
  `POST /audio/recordings`; Electron writes no audio.
- Dev and packaged data stay apart (`electron/backend-identity.js`); never point dev work at
  `~/.config/sonorus`.
- No new network requests. Anything that contacts a server must be listed in `docs/docs/privacy.md`;
  third-party telemetry stays forced off (`app/__init__.py`).
- Icons are files in `ui/src/assets/icons/` used through `Icon`, and values come from
  `ui/src/styles/tokens.css`: no raw colours or spacing and no palette tokens in components, a test enforces it
  (`docs/docs/ui/electron/foundations.md`). Layout spacing goes through `Stack` and `Inline`.
  Speaker initials are worked out only by `Avatar`; a test enforces it.
- A control whose feature does not exist yet is marked with `markNotImplemented()`
  (`ui/src/not-implemented.ts`, as props on the control)
  — never hidden and never faked. When the feature lands, remove its id and the call.
- UI text: no `·` separators, no all-caps labels. Straight quotes. An ellipsis `…` only for something in
  progress or a name cut to fit, never on a command (`docs/docs/ui/electron/foundations.md`).
- Screens get data only through `useApi()` and the hooks in `ui/src/api/queries.ts`, never `fetch`. A test fails
  until `npm run gen:api` follows a change to the API.
- Every component in `ui/src/components/<Name>/` has `<Name>.stories.tsx` with a story for each of its
  states, so it can be seen in Storybook. A build test checks that the file exists.

## Workflow

- **Bug fixes are test-first:** a failing test that reproduces the bug, then the fix, then the full
  suite (Python, UI, Electron and, if relevant, build tests).
- **One logical change per commit.** Conventional commits with a scope, as in `git log`:
  `fix(capture): …`, `feat(api): …`, `docs: …`, `refactor(ui): …`, `test: …`. The body says
  why, not what.
- **Branches:** `type/kebab-case` (`fix/…`, `feat/…`, `docs/…`). Never commit to `main` directly.
- **Docs:** English. A behavior change updates the matching page in `docs/docs/` in the same
  change. Docs describe how the system works; planned work, open bugs and ideas do not go in
  `docs/` — known limitations with workarounds go in `docs/docs/known-issues.md`.
- **Never commit** `.env`, `opencode.json` or other local tool configs, model weights, recordings or
  databases.
