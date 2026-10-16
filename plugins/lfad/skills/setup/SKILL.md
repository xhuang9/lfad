---
name: setup
summary: Install or repair the agent dashboard for a project.
description: Install / bootstrap the agent dashboard (lfad) for a project — place the tool, build it, create + git-init the project's `.agent-dashboard` board with the default nine-step pipeline, scaffold `.env`, and verify. Idempotent and re-runnable. Auto-invoke when the user says "install lfad", "set up the agent dashboard", "bootstrap the board", "add the dashboard to this project", "reinstall/repair lfad", "install hitloop", or runs /lfad:setup. This is the canonical, reproducible install — prefer it over doing the steps by hand.
---

# lfad:setup — install the agent dashboard for this project

This is the **single reproducible install path**. Do not improvise the steps by hand — run the bootstrap script, which is idempotent (never wipes an existing board, never overwrites `.env`).

## Canonical layout

One installed tool runs against each project's own board (the tool is shared, the board is per-project):

```
<project>/
  .agent-dashboard/  # the board this project's tickets live in (its own local git)
    .lfad/           #   ↳ the tool (packages/{core,runtime,ui} + plugins/lfad), gitignored by the board
    .ui/             #   ↳ the served UI, gitignored (copied from the tool on serve)
```

- **Canonical layout: the tool lives INSIDE the board** at `<project>/.agent-dashboard/.lfad` with `LFAD_BOARD=..` in its `.env` — one self-contained `.agent-dashboard/` folder. Dot-prefixed board-root entries are machinery, never steps (step keys cannot start with a dot; the watcher ignores dot entries), and the board's `.gitignore` covers `.lfad/`.
- The **sibling layout** also works: tool at `<project>/lfad` with the default `LFAD_BOARD=../.agent-dashboard`.
- **Boards made before the rename** keep working unchanged: `<project>/.flow/.hitloop`, `HITLOOP_*` variables, `.hitloop-settings.json` and `.hitloop-worktrees` are all still read.
- If the tool lives somewhere else entirely, set **`LFAD_HOME`** to its path (the `lfad:up` launch skill reads it).

## Steps

1. **Install the tool (a git clone).** The dashboard is a standalone project; each managed project gets its own install. If `<project>/.agent-dashboard/.lfad` (canonical) or `<project>/lfad` (sibling) doesn't exist yet, clone it: `git clone https://github.com/xhuang9/lfad.git <project>/.agent-dashboard/.lfad`. The clone's `origin` is the product repo — **updating the install is `git pull` + `pnpm install` + `pnpm build`** (then restart the daemon). Never develop the product inside a consumer project; changes flow dev repo → pull.

2. **Run the bootstrap** from the tool root:
   ```bash
   cd <project>/.agent-dashboard/.lfad   # or <project>/lfad in the sibling layout
   pnpm install        # first time only
   pnpm bootstrap          # build + ensure board + git-init board + scaffold .env + verify
   ```
   Useful flags: `pnpm bootstrap --prefix <name>` (the skill prefix; default `lfad`, so skills run as `/lfad:up`; asked at a terminal when omitted), `pnpm bootstrap --seed` (seed example tickets, only when the board is empty), `pnpm bootstrap --board <path>` (board elsewhere), `pnpm bootstrap --no-build`.

   What `pnpm bootstrap` does (idempotent): builds the monorepo → ensures `<project>/.agent-dashboard` exists (never wipes it) and, on a **fresh** board, writes the default `board.yml` — the nine-step pipeline `idea → research → interview → mock → design → todo → doing → review → done` (mock/design gated on `needsDesign`) — plus its step folders → seeds only with `--seed` on an empty board → `git init`s the board with a first snapshot → copies `.env.example` to `.env` if missing → verifies the build artifacts + board and prints the resolved config. If it finds an **old numbered layout** (`0-idea/` …) with no `board.yml`, it stops and points you at `scripts/migrate-board.mjs` rather than guessing (see "The board's steps" below).

3. **Review `.env`** (`<tool root>/.env`). Defaults are safe (dry-run on). `LFAD_BOARD` is the one path var to check — `..` in the canonical layout, `../.agent-dashboard` in the sibling layout; the code-repo and headless-engine vars are the table below, and `.env.example` documents the rest.

4. **Launch** with the `lfad:up` skill (or `pnpm demo` for a throwaway sandbox board at `<tool>/.demo-flow`). `lfad:up` serves the project's board on localhost and opens it in the browser.

## The headless engine (dormant) + code-repo config

The dashboard ships a headless run engine (daemon-spawned agent runs), and it is **dormant by design — the UI has no surface for it**: the board's buttons copy slash commands (e.g. `/lfad:interview 12`) for you to paste into your own Claude Code session, and that pasted session does the work. The engine's routes, adapters, and config are kept and stay functional for driving runs yourself (scripted or experimental use); the notes below configure that dormant path plus the code-repo vars the interactive flow also reads.

When the engine IS driven, runs are **dry-run by default** (write artifacts, no code commits, no tokens beyond the agent call) and **autopilot** advances agent-work steps, stopping at any human gate (`type: gate`) or a terminal / blocked step. On the default board that plays out as: a ticket entering `idea` is structured, researched, then **waits at the `interview` gate for your answers** (and, on `needsDesign` tickets, at the `mock` and `design` approval gates); once the gates clear, agents carry it `todo → doing → review → done`.

**Which CLI runs an engine step — and with what model / effort / permissions — is per-board data, not env.** It lives in the `agents` adapter section of `<board>/board.yml`; each `agent`-type step names an adapter (or inherits the board's `default`). See "The board's steps" below and `docs/board.example.yml` for the full adapter schema.

> **Breaking change:** `LFAD_AGENT_CMD` and `LFAD_PERMISSION_MODE` were **removed**. The command, args, model, effort, and any permission flag are now adapter fields in `board.yml`, so a step can pick its own model instead of every run using one global command.

> **Headless skills:** `claude -p` does NOT load user-level plugins, so every `claude` adapter should pass `--plugin-dir` `{pluginDir}` (the built-in adapter does) — that placeholder resolves to the installed tool's `plugins/lfad` and is what makes the `flow:*` skills available inside engine runs.

The remaining vars stay in `.env` (host config, board-independent). `LFAD_CODE_REPO`, `LFAD_WORKTREE_ROOT`, and `LFAD_DRY_RUN` also govern interactive lfad:build sessions — the worktree primitive and commit policy read them; the rest matter only when the engine is driven:

| Var | Default | Notes |
|---|---|---|
| `LFAD_CODE_REPO` | (unset) | repo the agent edits. **Unset → doc/dry-run only, no worktree.** |
| `LFAD_DRY_RUN` | `true` | no code commits while true. |
| `LFAD_WORKTREE_ROOT` | `<codeRepo>/../.lfad-worktrees` | where per-ticket worktrees go; skills create them via `flow worktree create <id> --branch <name>` (branch policy lives in the skill, not the engine). |
| `LFAD_RUN_TIMEOUT_MS` | `600000` | hard per-run wall-clock limit. |
| `LFAD_AUTOPILOT` | `true` | auto-advance agent-work steps; stop at gates / terminal / blocked. |

### First real code changes (the only config that touches your repo)
1. Set `LFAD_CODE_REPO` to the project's code repo (e.g. `<project>/main`) — unset, lfad:build is doc/dry-run only, no worktree.
2. Keep `LFAD_DRY_RUN=true` to watch one full cycle (no commits); then flip to `false` to let the build skill commit inside its per-ticket worktree (your main working tree is never touched).
3. Engine only: confirm the board's `default` adapter (in `board.yml`) is the real `claude` (the user's Claude Code login) — the default board and `docs/board.example.yml` both default to it.

## The board's steps (`board.yml`)

`<board>/board.yml` is the **single source of truth for the pipeline**. It declares the ordered `steps` array (each step's `key` IS its bare folder name — `todo/`, not `2-todo/`; the UI shows `2-todo` headers from the array position) and the `agents` adapters that power agent steps. `blocked/`, `parked/`, and `_archive/` are system directories and never appear in it. The loader accepts the legacy `stages:` key on read; new boards are written with `steps:`.

- **Setup always creates the default board** — `idea → research → interview → mock → design → todo → doing → review → done` (idea/research/todo/doing agent steps; interview, mock, design, and **review** human gates — mock/design with `skipUnless: needsDesign`; `review` is the code-review gate between doing and done; done terminal). `idea`, `interview` and `todo` are entry steps, each with an `entryWhen` line that `lfad:new` uses to pick where a new ticket starts plus the system `blocked/`, `parked/`, and `_archive/`. There are **no presets**; every board starts the same and grows from there — e.g. add a checks step later with `lfad:add-step`, bound to your project's own gate skill. The daemon fails fast on an invalid `board.yml` and hot-reloads a valid edit (no restart).
- **Grow / reshape the board with the `lfad:add-step` skill** — it interviews an add / edit / remove of a step and writes valid YAML for you (folder-safe keys, valid types, resolvable adapters), then the running daemon hot-reloads it. To move tickets between existing steps, use `lfad:move`; to retire finished tickets into `_archive`, use `lfad:archive`.
- **Migrating an old numbered board** — a legacy layout (`0-idea/` … `13-monitor/`) with no `board.yml` predates config-driven steps. Bootstrap refuses to guess; run the one-time migration, which renames the numbered folders to bare keys and writes an equivalent `board.yml`:
  ```bash
  node scripts/migrate-board.mjs <board>
  ```
  Then re-run `/lfad:setup`. `docs/board.example.yml` is the full grown-board reference the migration reproduces.

## Verify

After setup, confirm: `node packages/runtime/dist/cli.js serve ..` boots (it serves the UI from `../.ui`, copied on serve), then `curl localhost:4319/api/info` returns the board path + config, `curl localhost:4319/api/steps` lists the nine default steps in order, and `curl localhost:4319/api/board` lists tickets. Start the daemon in the background; never block the session and never kill a server you didn't start.

## Reproducibility note

Everything deterministic lives in `scripts/setup.mjs` (idempotent). This skill is the human-facing runbook over it. Re-running `lfad:setup` repairs a broken install without data loss.
