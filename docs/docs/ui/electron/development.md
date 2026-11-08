---
sidebar_position: 9
---

# New UI development

Practical notes for working on the new UI in `ui/`: where the data of a run lives, how to check a change on isolated data, when a dev server has to be restarted, and what the test environment cannot show. The commands themselves are in [Electron UI → New UI](overview.md#new-ui).

## Where the data lives

`npm start` and `npm run dev:ui` use the dev profile, never the installed app's (`electron/backend-identity.js`):

| System | Dev profile | Installed app |
|---|---|---|
| Linux | `~/.config/sonorus-dev` | `~/.config/sonorus` |
| macOS | `~/Library/Application Support/sonorus-dev` | `~/Library/Application Support/sonorus` |
| Windows | `%APPDATA%\sonorus-dev` | `%APPDATA%\sonorus` |

`--user-data-dir=<dir>` replaces the profile with `<dir>`. Work in development never points at the installed app's folder.

The backend is always on port 8000, and Electron reuses a development backend that already answers there. Before a check, make sure nothing else holds the port, or the window talks to that backend and its data.

## Checking on isolated data

Tests do not cover layout, so a UI change is checked in the running app on a data directory of its own:

1. Create the directory and seed it **before** the backend starts: the backend reads speaker memory once at startup. Seeding scripts that import app code need `PYTHONPATH=.`. Timestamps such as `created_at` are ISO (`2026-11-03T23:13:10.000000`); a space-separated SQLite datetime breaks the recording list. Audio paths in a copied database point into the original profile, so repoint `transcriptions.audio_file` to the copy.
2. Start the backend on that directory and Electron with the same directory as its profile, so settings and data stay in one place. In development Electron reuses any development backend on port 8000 whatever its data dir, so it is the backend that decides which data the window shows.

```bash
SONORUS_DATA_DIR=<dir> .venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
npm run dev:ui -- --user-data-dir=<dir>     # hot reload; or: npm start -- --new-ui --user-data-dir=<dir>
```

A backend started by hand for `npm run dev:ui` also needs `SONORUS_DEV_UI_ORIGIN=http://localhost:5173`. Without it CORS refuses every request from the dev page: the UI shows "Could not load recordings" while the backend log shows 200. `npm run dev:ui` sets the variable only for a backend that Electron starts itself. Likewise, Electron started without `scripts/dev-ui.js` while Vite runs separately needs both `SONORUS_UI_DEV_URL` and `SONORUS_DEV_UI_ORIGIN` ([Configuration](../../environment/configuration.md)).

Without a backend of your own, `VITE_SONORUS_FIXTURES=1 npm run dev:ui` runs the screens on fixtures ([New UI data → Fixtures](new-ui-data.md#fixtures)).

Check every affected row and state, not only the edited element: a layout fix that holds one row in place can move its neighbours instead.

## When to restart a dev server

| After editing | Restart | Why |
|---|---|---|
| `ui/src/styles/tokens.css` or `ui/src/main.tsx` | Vite (`npm run dev:ui`) | Electron can hang on load, waiting for navigation, although every file answers |
| `ui/src/styles/control.module.css` | Storybook | Vite does not transform a module that `composes` a changed file again, so stories keep the old CSS |

Storybook's port 6006 may be taken by another Storybook, and Storybook then stops at a question about the port. Pass another one: `npm --prefix ui run storybook -- --port 6007`.

Storybook is not the place to judge timings on long recordings: its highlight addon walks the page on every DOM change. Measure on `VITE_SONORUS_FIXTURES=1 npm run dev:ui` or in Electron. Motion and pointer behaviour are judged in the running app too.

## Working in a git worktree

- A worktree has no `.venv`. Without a backend on port 8000, Electron shows no window until one answers. Start uvicorn from the main checkout's venv with `--app-dir <worktree>`, or link the venv into the worktree. The link is not covered by `.venv/` in `.gitignore` (that pattern matches directories only): add files to git by name and remove the link before merging.
- The root `node_modules` of a worktree is a real directory; do not replace it with a link.
- After merging a change that adds packages to `ui/`, run `npm --prefix ui ci`.
- A `ui/dist` built before a change to the CSP in `ui/index.html` fails the CSP build test. Rebuild it with `npm run build:ui`.

## Unit tests

- `fsModuleCache` is off in `ui/vite.config.ts` on purpose: a cached transform keeps an old `import.meta.glob`, and the tests that walk the sources would miss new files. When adding such a guard, check it once with a deliberate violation.
- A test may take up to 15 s (`testTimeout` in `ui/vite.config.ts`). Screen tests that render the whole Editor take 1–2 s on a developer machine and three to four times that on a CI runner. To see CI timings locally, run the suite on two cores: `taskset -c 0,1 npm --prefix ui test`.
- CSS is not blanked in tests (`css.include`), because tests read tokens and styles through `?raw`. A test that parses CSS should still check that it got non-empty input.
- jsdom has no layout. It does not work out `:focus-visible`, has no `Range` geometry (stubbed in `ui/src/test-setup.ts`) and no `ResizeObserver` (stubbed there too; a test stub must keep every callback, not the last). It does not reproduce event-order bugs of overlays either: check those in a browser.
- Radix returns focus a tick after an overlay closes and moves arrow focus in a `setTimeout`: wait before the next step, or focus lands in the next test. Radix radio arrows choose only while the key is held (`{ArrowRight>}`).
- `userEvent` sets no `relatedTarget` on pointer events; use `fireEvent.pointerOut` / `pointerOver` where Radix needs it. For hover delays use `vi.useFakeTimers({ shouldAdvanceTime: true })` and advance by the token value; plain fake timers hang `findBy`.
- The unimplemented-controls guard reads the sources as text: a comment that names `markNotImplemented(` or says "not available" trips it.
- `tests/build/ui-package.test.js` rejects remote URLs anywhere in `ui/src`, tests included. Use `blob:` or `localhost`.

## Driving Electron with Playwright

- Pass `--mute-audio` to Electron in automatic runs.
- Playwright adds `--hide-scrollbars`; use `ignoreDefaultArgs: ['--hide-scrollbars']` to see the scrollbars.
- The first mouse move after launch is lost: move once before measuring.
- Move the mouse with `steps`. A single jump leaves Radix tooltips in transit.
- Stubs are `aria-disabled`: click them with `{ force: true }`.
- A `Modal` of type danger has the role `alertdialog`, not `dialog`.
- Electron's clipboard is the system clipboard. Save it with `app.evaluate(({ clipboard }) => clipboard.readText())` before a copy check and restore it after.
- Take coordinates first and then move only the mouse: role queries over a long transcript take tens of milliseconds each.
- A screenshot right after load can miss elements that fade in; measure the element instead.
