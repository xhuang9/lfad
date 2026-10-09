---
name: up
summary: Start the daemon if needed and open the board in the browser.
description: Bring the agent dashboard up — start the daemon for the CURRENT project's board (`.agent-dashboard`, or `.flow` on older boards) when it is down, then open the localhost preview in the browser so the user can watch tickets flow through the steps. Auto-invoke when the user says "open the flow board", "bring up the board", "flow up", "open the agent dashboard", "launch lfad", "launch hitloop", "open the board preview", or runs /lfad:up. The dashboard is a view-only status board (agents move tickets); this skill only starts and opens the viewer.
---

# lfad:up — the board, live on localhost

The agent dashboard is **one installed tool** that runs against **any project's board folder** (the board is the per-project data; the tool is shared). This skill starts the daemon pointed at the **current working directory's** board and opens the dashboard in the browser.

## Prerequisite

The tool must be installed/built first — that is the **`lfad:setup`** skill (`pnpm bootstrap`). Step 2 below detects a missing build; if it is missing, run `/lfad:setup` once, then return here.

## Where the board and tool live

Resolve `BOARD`, `HOME_DIR` and `PORT` with the block in `lfad:move` ("Find the board and the daemon"). The board is `LFAD_BOARD` if set, otherwise `$PWD/.agent-dashboard`, or `$PWD/.flow` for a board made before the rename. The tool is `LFAD_HOME` if set, otherwise inside the board (`.lfad`, or `.hitloop` on older boards), otherwise a sibling `lfad/` or `hitloop/` folder. Only if none exists, ask the user where the tool is. Dot-prefixed entries in the board root are machinery, never steps: step keys cannot start with a dot, and the daemon's watcher ignores them.

## Steps (run with Bash)

1. **Resolve the board and tool** with the `lfad:move` block. Confirm `"$HOME_DIR/packages"` exists; if not, ask the user for the tool path. The CLI is `"$HOME_DIR/packages/runtime/dist/cli.js"`, the built UI is `"$HOME_DIR/packages/ui/dist"`.
2. **Build if needed** (first run only): if `"$HOME_DIR/packages/runtime/dist/cli.js"` or `"$HOME_DIR/packages/ui/dist/index.html"` is missing, build the tool: `pnpm -C "$HOME_DIR" -r build`.
3. **Check the board** at `$BOARD`. The daemon creates it if missing and, on a fresh board, writes a default `board.yml` (+ the system `blocked`/`parked`/`_archive`) so a new project shows its columns empty — lfad:setup's bootstrap writes the full default pipeline `idea → research → interview → mock → design → todo → doing → review → done` (mock/design gated on `needsDesign`). If it instead has an **old numbered layout** (`0-idea/` …) with no `board.yml`, the daemon refuses to start (fail-fast) — run `/lfad:setup` to migrate first.
4. **Use `$PORT`** from the `lfad:move` block (the tool's `.env` sets it; default `4319`). If something already answers on `http://localhost:$PORT/api/health`, check `curl -fsS localhost:$PORT/api/info`: when its `boardRoot` is `$BOARD`, the board is already running, so skip straight to opening it. When it is another project's board, do not open it: tell the user the port is taken and to set a free `LFAD_PORT` in `$HOME_DIR/.env`. Otherwise start the daemon **in the background** (do not block the session, and never kill a server you didn't start). No `--ui` needed — the daemon copies the tool's built UI into `<board>/.ui` (gitignored) and serves from there:
   ```bash
   node "$HOME_DIR/packages/runtime/dist/cli.js" serve "$BOARD" --port "$PORT"
   ```
5. **Wait for ready**: poll `http://localhost:$PORT/api/health` until it returns `{"ok":true}` (≈ a few seconds).
6. **Open it**: `open http://localhost:$PORT` (macOS) and tell the user the URL.

## Verify it is really up

- `curl -fsS localhost:$PORT/api/info` returns the board path + resolved config — confirm it points at **this** project's board.
- `curl -fsS localhost:$PORT/api/steps` lists the pipeline steps in order; `curl -fsS localhost:$PORT/api/board` lists the live tickets.
- The UI's **Manual** modal (`GET /api/manual`) lists the flow skills straight from the plugin, so it always matches the installed library.

## What the user sees

- Two rows of steps: **needs-you** (steps waiting on the human — `idea` and the `interview`/`mock`/`design`/`review` gates) and **agents** (steps agents work — `research`, `todo`, `doing`, `done`), plus the lateral `blocked` step. `_archive` is a cold store and never renders (see lfad:archive).
- The board is **view-only**: agents do all the moving, per the lfad:move grammar. A ticket's action buttons **copy slash commands** — clicking `lfad:interview` copies `/lfad:interview 12` to the clipboard (⌃1…⌃9 from the keyboard) — and the user pastes the command into their own Claude Code session to run the step. Nothing in the UI runs agents.
- **The content rail is the ticket folder's markdown**: the drawer lists every `.md` in the ticket folder — `Idea` (the ticket body) and root files (e.g. `context.md`) first, then one group per step subfolder (`research/`, `interview/`, `todo/`, `doing/`, …) in pipeline order. Whatever a step's skill writes appears there live; images referenced from the ticket's `images/` folder (`../images/name.png`) render inline, and ticket `.html` files (mocks/designs) are served sandboxed via each step's summary links.
- Humans approve by answering a gate's question blocks — inline in the step files, or one-at-a-time via the drawer's **input mode** (`/t/<id>/input`, the amber "? n" badge); the next step's pull-validate is what carries the ticket forward.
- Live updates over SSE: edit a ticket on disk and the board reflects it; editing `board.yml` hot-reloads the pipeline with no restart. Reshape the steps with `lfad:add-step`, never by hand.

## Notes

- The served UI lives at `<board>/.ui` (gitignored, copied from the tool on each serve), so the board folder is self-contained. `LFAD_UI_DIR` can override it.
- Configuration (port, board location, run-engine vars) is read from a `.env` in the directory you run from; see `$LFAD_HOME/.env.example` and the lfad:setup skill.
- After updating the tool (`git pull` + rebuild in the install), restart **your own** daemon to pick the new build up: find its PID via the port (`lsof -ti tcp:$PORT`), stop that PID only, then serve again — never kill a server you didn't start.
