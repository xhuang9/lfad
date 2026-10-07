---
name: add-skill
summary: Author a new skill from natural language and bind it to a step.
description: Create a NEW skill for an agent-dashboard board and bind it as an action on a step — the user picks the target step, describes the skill's logic in natural language (including where the ticket moves when it's done), and this skill writes a project-local SKILL.md carrying that logic verbatim, then adds it to the step's `actions` list in board.yml. Auto-invoke when the user says "add a skill", "bind a skill to a step", "create a skill for the board", "new action for a step", "add a button to the step", or runs /lfad:add-skill. For adding/editing a COLUMN use lfad:add-step; this skill adds a new ACTION to an existing column.
---

# lfad:add-skill — author a skill and bind it to a step

A step's `actions:` list in `board.yml` is the source of truth for what can process a ticket sitting there — each entry renders as a **copy-command button** in the drawer (⌃1…⌃9): clicking it copies `/<skill> <ticket-id>` (e.g. `/review-copy 12`) to the clipboard, and the user pastes that into their own Claude Code session to run the skill. This skill grows that list with a **user-defined skill**: ALL of its logic — what it does, what it writes, and **where the ticket moves when it finishes** — lives in the skill file itself. The engine stays mechanism-only: the button copies a command, nothing more; any movement is the skill's own doing (via the `lfad:move` mechanics).

Resolve the board and daemon exactly as `lfad:move` describes.

## Interview (keep it to one round when possible)

1. **Target step** — `GET /api/steps`, list the non-lateral steps as a choice, ask which one this action belongs to.
2. **Skill name** — short kebab-case (`^[a-z][a-z0-9-]*$`), verb-flavored ("run-checks", "review-copy", "ship"). Confirm it doesn't collide with an existing skill in the session's skill list or the project's `.claude/skills/`.
3. **The logic, in the user's own words** — what the skill should do to the ticket, end to end. Explicitly confirm the one thing users forget: **"when this skill finishes successfully, which step does the ticket move to (or does it stay)?"** Also capture: what artifact/file it writes (if any), what counts as failure and where a failed ticket goes, and anything it must never do.

## Author the skill file

Write `<project>/.claude/skills/<name>/SKILL.md` (the project root is the board's parent directory — for a board at `<project>/.agent-dashboard`, that's `<project>`). Project-local skills load in every Claude session under the project **including headless runs** (their cwd — worktree, code repo, or board — sits under the project root).

Shape it like the flow skills:

- Frontmatter: `name`, `summary` (one line), `description` (what it does + when to auto-invoke, mentioning the bound step).
- **The user's logic, preserved faithfully** — structure it into sections (what to check first, the work, what to write where) but keep their rules and wording; do not invent scope they didn't state.
- **Outputs to the step subfolder** — files the skill writes for the board go to `<ticket>/<step-key>/NN-{slug}.md` (numbering from `00`, next free NN; images in `<ticket>/images/`, referenced relatively as `../images/name.png`). That is what the board's content rail lists, grouped under the step.
- **Movement policy** — its own section, from the interview answer: "when done, move the ticket to `<step>` with a reason" (or "the ticket stays; a human moves it"). Movement mechanics defer to `lfad:move` (reference it; never restate the grammar).
- **Escalation** — on any B1–B5 trigger or a failure the logic doesn't cover, block per `lfad:move` (`FLOW_BLOCK: <one-line question>` in a daemon run; ask the user directly in a pasted-command session).
- **Run protocol (dormant headless engine only)** — the headless run engine remains in the codebase with no UI surface; when it executes a skill, the run must end with the `FLOW_DONE` sentinel after the work (the engine completes an action run in place; this skill's movement policy is what moves the ticket). In a normal session — the user pasted the copied command — no sentinel is needed.

## Bind it in board.yml

1. Edit `<board>/board.yml`: find the target step and append the skill name to its `actions:` list (create the list if absent — mind the existing order; first entry = ⌃1).
2. VALIDATE before finishing: `node -e "import(process.argv[1]).then(m => { m.loadBoardConfig(process.argv[2]); console.log('ok') })" "<tool>/packages/core/dist/index.js" "<board>"` — an invalid edit is rejected by the daemon (it keeps the previous config), so fix and re-validate.
3. The running daemon hot-reloads the config (`config-changed` SSE) — the new button appears without a restart.

## Report

Tell the user: the skill file path, the step it's bound to, its copy-command button position (and shortcut ⌃n — clicking copies `/<name> <id>` for them to paste), and the movement-on-done rule as written. Remind them the logic is theirs to edit — the SKILL.md is the single source of truth for this action.
