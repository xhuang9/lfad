---
name: add-step
summary: Add, edit, or remove a step in the board's pipeline.
description: Grow or reshape an agent-dashboard board's pipeline by adding, editing, or removing a step in `<board>/board.yml` — the source of truth for the pipeline. Interview the change, write valid YAML (folder-safe key, reserved blocked/parked/_archive, a valid type, a resolvable agent adapter), create or rename the on-disk folder, and let the daemon hot-reload it with no restart. Auto-invoke when the user says "add a step", "add a column", "new step", "insert a step", "rename a step", "change a step", "reorder the steps", "remove a step", "delete a column", "edit board.yml", "add a checks/test step", "define an agent adapter", or runs /lfad:add-step. For moving tickets between existing steps use lfad:move; for the first install use lfad:setup.
---

# lfad:add-step — manage the board's steps

A board's steps are **data, not code**: `<board>/board.yml` declares the ordered `steps` array (a step's `key` IS its on-disk folder name) plus the named `agents` adapters that power agent steps. This skill interviews one step change, writes it to `board.yml`, reconciles the folders, and lets the running daemon pick it up.

Two invariants shape everything below:

1. **`board.yml` is the single source of truth for the steps.** Unlike tickets (which always route through the daemon or the `flow` CLI), `board.yml` is a plain config file you edit **directly on disk**. There is no REST endpoint for it. It also holds board-wide keys (`guidance`, `writing`, `localRules`; see `docs/board.example.yml`): keep them unchanged when editing steps.
2. **The daemon hot-reloads it.** A watcher notices the `board.yml` write, revalidates, swaps the config, and emits a `config-changed` SSE event — the board updates with **no restart**. An *invalid* edit is rejected and the daemon keeps the previous config, so **always validate before you rely on the change**.

Write the `steps:` key; the loader also accepts the legacy `stages:` alias on read (old boards) and normalizes it — new writes always use `steps:`.

## Find the board and the tool

Resolve `BOARD`, `HOME_DIR`, `PORT` and `BASE` with the block in `lfad:move` ("Find the board and the daemon"), then:

```bash
curl -fsS "$BASE/api/health"                          # {"ok":true} → the daemon is live (hot-reload will apply)
```

Validate any `board.yml` edit through core's own loader — it is the exact check the daemon runs, and it also creates a missing step folder and refuses a config that leaves a stray directory holding tickets:

```bash
VALIDATE() {
  node -e 'const {pathToFileURL}=require("url");import(pathToFileURL(process.argv[1]).href)
    .then(m=>{const c=m.loadBoardConfig(process.argv[2]);console.log("board.yml OK —",c.steps.map(s=>s.key).join(" → "))})
    .catch(e=>{console.error(String(e&&e.message||e));process.exit(1)})' \
    "$HOME_DIR/packages/core/dist/index.js" "$BOARD"
}
```

## Read the current steps first

Always ground the change in the live pipeline before editing.

| What | Daemon live (primary) | Daemon down (fallback) |
|---|---|---|
| Steps, order, types | `GET /api/steps` → `{key,label,folder,lateral,type,row,position,entry}` per step | read `<board>/board.yml` |
| What's in a step | `GET /api/board` | list the step folder for `NNNNN-slug` ticket dirs |

`position` is the 0-based array index; the UI renders headers as `${position}-${key}` (e.g. `2-todo`). The folder itself is the bare `key` (`todo/`, never `2-todo/`).

## The `board.yml` schema (write valid YAML)

```yaml
version: 1
agents:                       # named adapters; any CLI whose stdout prints the FLOW_BLOCK:/FLOW_DONE sentinels
  <name>:
    cmd: claude               # executable
    args: ["-p", "{prompt}", "--model", "{model}", "--effort", "{effort}"]  # placeholders substituted per token, no shell
    output: stream-json       # stream-json (default) | text — how stdout is scanned for sentinels
    model: opus               # value for the {model} placeholder
    effort: high              # value for the {effort} placeholder
    workflow: true            # optional; prepends the word "ultracode" to the prompt (multi-agent opt-in)
steps:                        # array order IS pipeline order
  - key: <folder-safe key>    # ^[a-z][a-z0-9-]*$, unique; blocked, parked & _archive are reserved system dirs
    label: <Human Label>
    type: agent               # agent | gate | queue | terminal
    row: agents               # optional; agents | needs-you (default: needs-you for gate, agents otherwise)
    skill: lfad:build         # optional; the skill that drives the step (policy lives in the skill)
    goal: "Done when …"       # optional; one-line done-criteria injected into the agent prompt
    artifact: notes.md        # legacy single-file mode (a filename, or the literal `body`); normally omit — steps write a `<key>/NN-{slug}.md` file set instead (see the artifact interview note)
    entry: true               # optional; tickets may be created directly into this step
    entryWhen: "…"            # optional, needs entry: true; when lfad:new should start a ticket here
    agent: deep               # optional; must name an adapter in `agents` (omit ⇒ default adapter)
    skipUnless: needsDesign   # optional; ticket frontmatter boolean — the step is skipped when falsy
```

Placeholders available in adapter `args`: `{prompt} {model} {effort} {ticketId} {step} {boardRoot} {pluginDir}` (plus `{stage}`, a deprecated alias of `{step}`). Every `claude` adapter should pass `--plugin-dir {pluginDir}` — it is what makes the `flow:*` skills available inside engine-spawned runs.

**Step `type` — what each does (offer these one-liners when interviewing):**

- **agent** — an agent works the step and, on a clean finish, autopilot advances to the next step.
- **gate** — a human decides on the board; the agent completes its work in place and the ticket waits (default row `needs-you`).
- **queue** — a holding step; no agent run is spawned and autopilot passes straight through.
- **terminal** — the pipeline ends here; autopilot stops.

`docs/board.example.yml` in the tool is a full grown-board reference to copy patterns from. Bind `skill:` to a skill that actually exists in the session — the library ships `lfad:idea`, `lfad:research`, `lfad:interview`, `lfad:absorb`, `lfad:mock`, `lfad:design`, `lfad:todo`, `lfad:build`; a checks/test/review step points at the project's own skill (e.g. a repo-local quality gate).

## Mode: add a step

Interview the definition one field at a time (skip a field when the answer is obvious from context), then write it.

1. **Position** — before or after which existing step? (This is the array index; pipeline order lives only in the array.)
2. **key** — folder-safe (`^[a-z][a-z0-9-]*$`), unique, not `blocked`/`parked`/`_archive`. This becomes the folder name.
3. **label** — the human-readable step title.
4. **type** — `agent | gate | queue | terminal` (offer the one-liners above).
5. **row** — `agents` or `needs-you`; default from type (gate → `needs-you`, else `agents`). Only set it to override.
6. **skill** — which skill powers the step (any skill name, including one the user wrote). Optional; informational for the prompt.
7. **goal** — the one-line done-criteria injected into the agent's prompt (e.g. `"Done when the repo's quality gate passes on the ticket's worktree."`).
8. **artifact** — where the step's outputs land. The convention: the step's skill writes a **file set** into the ticket's step subfolder (`<ticket>/<key>/NN-{slug}.md`, numbered from `00`; the board's content rail groups them under the step) — that needs no `artifact:` field, so normally **omit it**. The single-filename `artifact:` (`notes.md`) and the literal `body` (the ticket body) stay supported as legacy for steps whose skill writes exactly one file.
9. **entry** — may tickets be created directly into this step? (`entry: true`.) If yes, ask **when**: one line for `entryWhen`, such as "The work is fully specified, with no open decisions." `lfad:new` matches each new ticket against these lines to pick its starting step, so a step without `entryWhen` is chosen only when the user names it. `entryWhen` without `entry: true` is rejected.
10. **agent adapter** — for an `agent`-type step, which named adapter runs it. Show the current `agents` names (`GET /api/steps` won't list them — read `board.yml`). If none fits, **offer to define a new adapter**: `cmd`, `args` (with the placeholders), optional `model`, `effort`, `output`, `workflow`. Omit `agent:` to inherit the board's `default` adapter.
11. **skipUnless** — optional: name a ticket frontmatter boolean flag; the step is skipped for tickets where it is falsy (e.g. `needsDesign`).

Then apply:

- Insert the new step block into the `steps` array at the chosen position (and add the new adapter under `agents` if you defined one).
- Create the folder: `mkdir -p "$BOARD/<key>"` (the daemon also creates missing folders, but be explicit).
- `VALIDATE` — confirm it parses and the schema holds.
- The daemon hot-reloads automatically (`config-changed` SSE); **no restart**. If the daemon is down, the change applies the next time it starts.

## Mode: edit a step

Change any field on an existing step (or adapter). For everything **except the key**, edit the field in `board.yml`, `VALIDATE`, and let the daemon hot-reload. Notes:

- Changing `type` to/from `gate` flips the *default* row — set `row` explicitly if you want to keep the old placement.
- Retargeting `agent:` must name an adapter that exists in `agents`, or `VALIDATE` fails.

**Renaming a key** (the key IS the folder, so both must move together):

1. Prefer to rename while the step is **empty** — no ticket's `status` names the old key and no run is mid-flight.
2. Update `key:` in `board.yml` (and any other step's `skipUnless:` reference or note that named it, if applicable).
3. Move the folder, preserving history — the board is its own git repo: `git -C "$BOARD" mv <old> <new>` (plain `mv "$BOARD/<old>" "$BOARD/<new>"` if the board is not git-tracked).
4. If the step **held tickets**, their frontmatter `status` still says the old key — the daemon's invariant is *folder == status*, so set each ticket's `status` to `<new>` as well, and **stop any in-flight run** on those tickets first (a run referencing the old key will fail).
5. `VALIDATE` and let the daemon hot-reload.

## Mode: remove a step

1. A step is removed **only when empty**. Check its folder for `NNNNN-slug` ticket dirs (`GET /api/board`, or list `$BOARD/<key>`).
2. If it still holds tickets, **move them out first** with the `lfad:move` grammar — e.g. `FLOW move <id> <otherStep> --reason "clearing <key> before removing the step"` (REST `POST /api/tickets/:id/move` when the daemon is live). Then remove.
3. Delete the step's block from the `steps` array in `board.yml` (keep at least one step — a board needs one). If you remove the only `entry: true` step, mark another step `entry: true` so new tickets have a home (otherwise entry falls back to the first step).
4. Delete the now-empty folder: `git -C "$BOARD" rm -r <key>` if tracked, else `rmdir "$BOARD/<key>"`.
5. `VALIDATE` and let the daemon hot-reload.

## After any change

- Confirm the live board: `GET /api/steps` reflects the new step set (or read back `board.yml`).
- `blocked/`, `parked/`, and `_archive/` are system directories — they are never listed in `board.yml` and are not managed here (retiring finished tickets into `_archive` is lfad:archive's job).
- Tell the user what changed and that the board updated without a restart.
