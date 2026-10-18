# Contributing to Sonorus

Thanks for your interest in Sonorus. This guide covers how to set up a development environment, what a
good change looks like and how to get it merged. If you use an AI coding tool, also point it at
[AGENTS.md](AGENTS.md) — it holds the same rules in a form agents read automatically.

## Before you start

- **Small fixes** (typos, an obvious bug with a clear fix) — open a pull request directly.
- **Anything larger** (a new feature, a behavior change, a refactor, a new dependency) — open an issue
  first and describe what you want to change and why. Sonorus has a fixed set of domain rules and a
  planned direction; agreeing on the approach first saves you from rewriting a finished change.
- Check [Known issues](docs/docs/known-issues.md) — your problem may already be described there, with
  a workaround.

## Development setup

You need Python 3.12, Node.js 22.12+, ffmpeg and git. The full guide, including GPU setup, is
[Environment → Setup](docs/docs/environment/setup.md) → Developer setup. In short:

```bash
python3.12 -m venv .venv
.venv/bin/pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_nltk_data.py
npm ci
```

To actually transcribe you need access to the gated PyAnnote models and a
[HuggingFace token](https://huggingface.co/settings/tokens) entered in **Settings → API Keys** — see
[README → HuggingFace access](README.md#4-huggingface-access). Transcription models are downloaded in
the app under **Settings → Models**.

You do **not** need the ML libraries, a token or any models to run the unit tests:

```bash
python3.12 -m venv .venv-test
.venv-test/bin/pip install -r requirements-test.txt
```

### Running the app

```bash
npm start
```

This starts the backend as well. A development build keeps its data in `~/.config/sonorus-dev`
(Linux; Electron's `userData` on other platforms), separate from an installed Sonorus. To run the
backend alone, for API work (it reads the token from `.env`: `cp .env.example .env`, set `HF_TOKEN`):

```bash
.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

It keeps its data in `$SONORUS_DATA_DIR`, or the current directory if that is unset. Use a temporary
directory so you never work on real recordings and speaker profiles.

## Tests

```bash
.venv/bin/python -m pytest tests/ -v      # Python
node --test 'tests/renderer/*.test.js'    # renderer
node --test 'tests/build/*.test.js'       # build and packaging checks
```

All three suites must pass before a pull request is merged. CI runs them without the ML libraries —
`tests/conftest.py` replaces them with stubs — so a test that passes in your full `.venv` can still
fail there. Run the suite in a venv with only `requirements-test.txt` before you open the pull
request. Details: [Testing overview](docs/docs/testing/overview.md).

Audio quality tests run real models on meeting recordings and are opt-in; you only need them for
changes to transcription, diarization or speaker matching. See [Quality tests](docs/docs/testing/quality.md).

## Making a change

1. **Branch from `main`**, named `type/short-description`: `fix/queue-retry-order`,
   `feat/export-srt`, `docs/gpu-setup`.
2. **Bug fixes start with a test** that fails without the fix. New behavior comes with tests too.
3. **Respect the domain rules.** Speaker memory is written in exactly one place, speaker ids are never
   display names, a user's correction always beats automatic results. The full list is in
   [Invariants](docs/docs/system/invariants.md) and [AGENTS.md](AGENTS.md#rules-that-must-hold); a
   pull request that breaks one will not be merged, even with passing tests.
4. **Check UI changes in the running app**, on a separate data directory, in every state you touched
   (empty, one item, many items, long names, narrow window). Tests do not cover layout.
5. **Update the docs** in `docs/docs/` when behavior changes, in the same pull request. Docs are in
   English and describe how the system works now — not plans or ideas. The docs site build must stay
   warning-free: `cd docs && npm ci && npx docusaurus build`.
6. **No new network requests** without discussion. Sonorus is local-first; every request it makes is
   listed in [Privacy](docs/docs/privacy.md).

There is no linter or formatter. Match the style of the code around your change.

### Commits

One logical change per commit, written as a
[conventional commit](https://www.conventionalcommits.org/) with a scope:

```
fix(queue): keep a failed job at the end after a restart

The job store sorted by creation time, so a failed job moved back to its
original position when the backend restarted.
```

Common scopes: `api`, `renderer`, `editor`, `electron`, `capture`, `models`, `packaging`. The body
explains *why*; the diff already shows what.

## Pull requests

- Keep a pull request to one topic. Unrelated fixes go in their own pull request.
- In the description, say what changed and why, link the issue, and list how you tested it. For UI
  changes, add screenshots or a short recording.
- Say which platforms you tested on. Live recording and packaging behave differently on Linux, macOS
  and Windows; if you could test only one, say so — that is fine.
- Expect review comments. Push follow-up commits to the same branch; history is cleaned up on merge
  if needed.

## Using AI tools

AI coding tools are welcome. A few rules apply on top of everything above:

- **You are responsible for every line** you submit, whoever or whatever wrote it. Read and understand
  the whole diff before you open a pull request, and be ready to explain any part of it in review.
- **Run the tests and check the app yourself.** "The agent said the tests pass" is not testing.
- **Keep the scope you asked for.** Agents tend to reformat, rename or "improve" code around a change;
  remove anything unrelated before you submit.
- **Do not let an agent invent behavior.** If it is unclear how something should work, ask in the
  issue instead of letting the tool guess.
- Point your tool at [AGENTS.md](AGENTS.md). Most tools read it automatically; for others, add it to
  the tool's context or instructions file.

## Reporting bugs

Open an issue with:

- the Sonorus version (Settings, or the release you installed) and your OS;
- what you did, what you expected and what happened;
- the log, if relevant: `sonorus.log` in the app's data folder — the path for your OS is in
  [Build and install](docs/docs/build-and-install/linux.md) (Linux, macOS and Windows pages). From
  source, see [Logging](docs/docs/environment/logging.md).

Recordings and transcripts often contain private conversations. Do not attach them unless you are
sure they can be public — a short synthetic clip that reproduces the problem is better.
