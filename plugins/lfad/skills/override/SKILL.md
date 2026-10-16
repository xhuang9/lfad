---
name: override
summary: Change how lfad behaves in this project without editing the plugin.
description: Override the plugin's defaults for one project. Routes each change to the right layer (board `writing`, board or step `guidance`, or the project's `lfad-local` skill named by `localRules`), writes it, mirrors it for Codex, and validates `board.yml`. Auto-invoke when the user says "override lfad", "change lfad defaults", "make the board write in <language>", "add a project rule for the agents", "agents should always / never …", "change what agents decide versus ask", "local rules", or runs /lfad:override. For adding or changing a column use lfad:add-step; for a new action button use lfad:add-skill.
---

# lfad:override: project overrides

Word every file you write by `../move/wording.md`. The `lfad-local` skill is read by agents, so write it in the board's `agentLanguage`.

Never edit the plugin's own files (`plugins/lfad/skills/`, or the tool copy inside the board folder). An update overwrites them. Every project change goes in `board.yml` or the project's `lfad-local` skill.

Resolve the board and daemon exactly as `lfad:move` describes. The project root is the board folder's parent.

## Pick the layer

Each change goes in the narrowest layer that fits. Later layers win.

| The user wants | Write it in | Shape |
| --- | --- | --- |
| Files a person reads in another language | `board.yml` → `writing.humanLanguage` | One phrase, such as `Simplified Chinese, keeping technical terms in English` |
| Files an agent reads in another language | `board.yml` → `writing.agentLanguage` | One phrase. Leave it English unless the user asks |
| One short rule for every step | `board.yml` → board-level `guidance` | One or two sentences |
| One short rule for one step | `board.yml` → that step's `guidance` | One or two sentences |
| A longer policy: wording rules, what agents decide versus ask, project conventions, anything over two sentences | The `lfad-local` skill | Markdown sections, see below |
| Let new tickets start at a step, or change when they do | `board.yml` → that step's `entry: true` and `entryWhen` | One line saying when a ticket starts there. `lfad:new` reads it |
| A new column, or a change to a step's type, order or skill | `lfad:add-step` | |
| A new action button on a step | `lfad:add-skill` | |

When a `guidance` value grows past two sentences, move it into `lfad-local` and delete it from `board.yml`, so each rule lives in one place.

## The lfad-local skill

The project rules live in a project skill at `<project>/.claude/skills/lfad-local/SKILL.md`. As a skill it also loads when an agent touches the board outside lfad's own skills, such as a manual move or a batch pass.

1. If the skill is missing, create it with frontmatter:
   - `name: lfad-local`
   - `summary:` one line naming the project and the topics covered.
   - `description:` the topics covered, that `board.yml` `localRules` points here and these rules win where they conflict, and when to auto-invoke: whenever an agent creates, moves, tags, writes files for or changes a ticket on this board.
2. Open the body with one line: "`<board>/board.yml` names this file in `localRules`. Read it after the plugin's own rules. Where the two conflict, this file wins."
3. Put each policy under its own `##` heading that names the subject, such as `## Decision boundary` or `## Writing for the owner`. Update the `summary` and `description` when you add a topic.
4. Keep the user's rules word for word. Structure them into lists and tables, but never soften, reorder the meaning of, or add to a rule they stated.
5. Make each rule checkable and give its reason: "Ask before adding a dependency, because the owner reviews every new package."
6. A topic past about 60 lines goes in its own file in the same folder, such as `batch-run.md`. The `SKILL.md` gets a short section saying when to read it.
7. Set `localRules: .claude/skills/lfad-local/SKILL.md` in `board.yml` if the key is missing.

If `localRules` already names a different file, read it. Ask the user whether to move its rules into `lfad-local` or keep editing the existing file. Never keep both.

### Mirror for Codex

If the project has a `.codex/` folder, copy the whole `lfad-local` folder to `<project>/.codex/skills/lfad-local/` after every edit. `diff -r` of the two folders must print nothing. Edit the `.claude` copy first and copy it across, so the two never drift.

## Validate

1. Validate `board.yml`: `node -e "import(process.argv[1]).then(m => { m.loadBoardConfig(process.argv[2]); console.log('ok') })" "<tool>/packages/core/dist/index.js" "<board>"`. The `writing` block is strict, so a misspelt key fails here. Fix and re-run until it prints `ok`.
2. With the daemon running, `GET /api/steps` must return the new `writing` values and the absolute `localRules` path. The daemon reloads `board.yml` on save, with no restart.
3. Edits to `lfad-local` need no reload. Every skill reads it fresh.

## Report

Tell the user which layer each change went into, the file path, and the rule as written. Name any rule you moved out of `guidance` into `lfad-local`.
