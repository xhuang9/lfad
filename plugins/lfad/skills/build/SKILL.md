---
name: build
summary: Implement the ticket in its own worktree, per the cleared gates and the breakdown.
description: Work the doing step of an agent-dashboard ticket — verify every upstream gate is cleared (interview; mock/design when they apply) and the todo/ breakdown set exists, read context.md first, provision the ticket's git worktree on a category-named branch, implement exactly what the breakdown and the cleared gates approved inside that worktree under the target repo's own guardrails, write progress/summary notes to the ticket's doing/ folder (what changed, commits, test evidence), commit when dry-run is off, escalate via FLOW_BLOCK on any B1–B5 trigger, and move to done when the work is complete. Auto-invoke when a ticket enters the doing step, when the user says "build ticket 12", "implement the ticket", "start the doing step", or runs /lfad:build. Movement mechanics defer to lfad:move.
---

# lfad:build — implement the ticket

This step turns the cleared gates and their breakdown into working code. All movement mechanics — finding the board and daemon, the `FLOW()` CLI helper, the pull-validate + push-stop grammar, the question grammar, fast-pass, and blocking — live in the **`lfad:move`** skill; invoke it first and follow its grammar. This skill defines only the build work itself.

## Entering (pull-validate)

Per `lfad:move`, run the generalized gate-walk before doing anything: walk backwards from doing through every gate that applies to this ticket and confirm each is resolved — on the default board that is **design** and **mock** (each only when its `skipUnless: needsDesign` flag is truthy and not fast-passed: the `## Approval` slot answered) and **interview** (zero open question blocks, latest round's Clarity at/above threshold). Additionally:

- the `todo/` breakdown set exists — the breakdown is the work order. Gates cleared but no `todo/` files → the ticket skipped lfad:todo; run that breakdown first (interactively say so; in a daemon run print `FLOW_BLOCK: ticket #<id> has no todo breakdown — run lfad:todo before building`).

All present → move the ticket into `doing` with a reason (`"gates cleared + breakdown ready — starting implementation"`) and begin. Anything unresolved → stop before any work and surface the open questions exactly as `lfad:move` prescribes.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

**Read `<ticket>/context.md` FIRST** — the root-level distilled brief (paths, symbols, settled decisions, hard constraints) — before pulling the step artifacts; the artifacts are the detail behind it.

## On entering doing: provision the worktree

Code changes live in a per-ticket git worktree — never in the operator's main working tree, and never in the board.

**1. Name the branch.** Branch = `<prefix>/<id>-<slug>` (e.g. `bugfix/12-login-timeout`), using the ticket's `category` and `slug` fields (`GET /api/tickets/:id` or `FLOW show <id>`). The category→prefix map is **policy that lives here, in this skill text** — the engine has no naming logic, so edit this table to change your convention:

| Ticket category | Branch prefix |
|---|---|
| `bug` | `bugfix` |
| `hotfix` | `hotfix` |
| `refactor` | `refactor` |
| everything else (`ui`, `logic`, `business`, …) | `feature` |

**2. Create it via the engine primitive** (mechanism only — it provisions the worktree and records the path in the ticket's `worktree` frontmatter field):

```bash
# REST (daemon up)
curl -fsS -X POST "$BASE/api/tickets/12/worktree" -H 'content-type: application/json' \
  -d '{"branch":"bugfix/12-login-timeout"}'
# CLI (daemon down)
FLOW worktree create 12 --branch bugfix/12-login-timeout
```

- The primitive is idempotent on the directory: a ticket re-entering `doing` (e.g. bounced back from a board-defined gate) reuses its existing `t-<id>` worktree — continue on the existing branch.
- "No code repo configured" means `LFAD_CODE_REPO` is unset: this is a doc/dry-run-only setup. Escalate (B4) if the ticket needs real code changes.

**3. Let the target repo fill in its own gitignored files.** `git worktree add` copies tracked files only, so a fresh worktree has none of the repo's gitignored env files and may not even start. Which files those are is the **target repo's** policy, not the engine's — the engine stays mechanism-only — so this step just invokes a provisioning script the repo may provide:

```bash
# <main> = the repo's primary checkout (LFAD_CODE_REPO); <worktree> = the path the primitive returned
[ -f "<main>/scripts/worktree-env-copy.ts" ] && npx tsx "<main>/scripts/worktree-env-copy.ts" "<worktree>" || true
```

- **Guarded on purpose.** A repo that ships no such script is a silent no-op — today's behaviour, no regression.
- **Idempotent per file, not per directory.** Re-run it every time a ticket enters `doing`, including on a reused worktree: it fills in whichever files are missing and never overwrites one that is already there. Do not add a "the worktree already exists, skip this" check — that is exactly the gap it repairs.
- Never read or echo what it copies. The script reports filenames; its output is the evidence, its inputs are not.

## Implement — inside the worktree only

Work from the ticket folder's briefing: `context.md` is the brief, the `todo/` set is the work order (chunk goals, files, steps, tests, dependency order), and the gate sets — `interview/` decisions plus the approved `mock/`/`design/` HTML on design tickets — are the contract behind it (decisions, constraints, risks, scope, the visual spec).

- **Every code edit happens inside the worktree** (the `worktree` path on the ticket). The board ticket folder receives artifacts only.
- **The target repo's rules outrank this skill.** Before editing, read the CLAUDE.md at the worktree root (and any ancestor-directory CLAUDE.md / guardrail skills the repo declares) and follow them — package manager, test commands, style contracts, protected paths. When the repo names a guardrail for the area you are touching, read it first.
- **Build only what the gates approved.** New scope, a different approach, or a change the cleared gates never mentioned is a B1 escalation, not a judgment call.
- **Work chunk by chunk in the breakdown's dependency order.** Each chunk ends verifiable (its Verify line holds, its named tests pass locally), so the diff stays reviewable and a bounce-back can resume mid-ticket.
- **Staged builds.** When the ticket carries an `extras.buildStages` marker (todo seeds it for multi-stage work), follow the authoritative `BuildStages` / `BuildStage` contract and `buildStagesSchema` in `packages/core/src/build-stages.ts` (exported by `@lfad/core` and `@lfad/core/build-stages`). Build **only the current stage** this pass — the chunk area(s) identified by `items[current − 1].key` — not the whole breakdown. Mark that item `building` when you start it and flip it to `review` when you push the stage to `review`. The next stage builds only after this one is approved and `review` sends the ticket back to `doing`, so a multi-stage ticket walks `doing → review` once per stage. A ticket with no marker builds the whole breakdown in one pass.

## Write board artifacts as you build

Code lands in the worktree; the board gets the story. **Honor the board's guidance and word every file by `../move/wording.md`** per `lfad:move` in these notes — language, format, tone; code, frontmatter, and filenames stay English. Write this step's outputs as markdown files inside the ticket folder at `<ticket>/doing/NN-{slug}.md` — numbering from `00`, next free NN. Decompose like a planning folder (shared context first, then one file per area) rather than one monolith — typically a `00-` progress note kept current chunk by chunk, plus per-area summary notes when the work warrants them. Each note records **what changed** (files, behavior), **the commits** (hashes + messages, or the dry-run diff state), and **the test evidence** (commands run, results). Put images — e.g. screenshots of the built behavior — in `<ticket>/images/` and reference them relatively (`../images/name.png`). Everything you write appears in the board's content rail: these notes are what the human reviews without opening the worktree.

Write each note via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"doing/00-progress.md","content":…}` — the route accepts nested paths and creates the `doing/` folder); daemon down → write the file into the ticket folder directly.

At each progress boundary and on exit, rewrite the CURRENT-STATE block at the top of `<ticket>/context.md` per the canonical definition in `lfad:move`. Keep the branch, commits, and test-evidence artifact in `Pointers`, and make `Next action` tell the reviewer what to inspect or the next build pass what to do first.

## Escalation (B1–B5)

The run prompt carries the full trigger definitions; honour them at all times. In short — escalate the moment the work can't align with what the gates approved (B1), touches core business logic AND user experience beyond that approval (B2), diverges from a set strategy (B3), needs access/credentials/a manual step you lack (B4), or your own judgment says the human would want to weigh in (B5). Before printing any `FLOW_BLOCK`, rewrite the CURRENT-STATE block so the blocked ticket still states what happened, what decision is needed next, and the relevant pointers. Inside a daemon run print `FLOW_BLOCK: <one-line question>` on its own line; in an interactive session ask the user directly. On a coin-flip, escalate.

## Committing

- `LFAD_DRY_RUN=true` (the default) → implement and stage nothing durable: plan, write artifacts, leave the diff uncommitted for inspection.
- Dry-run off → commit **inside the worktree**, following the target repo's commit conventions (message format, hooks, granularity). Commit code only; the board's git belongs to the daemon/CLI alone (see `lfad:move`).
- Push nothing. Merging and shipping are decided later (the board's ship policy), never at build time.

## Finishing (push-stop)

Make the work durable first — committed (or, in dry-run, a clean reviewable diff), with the `doing/` summary note recording what was built and any deviations worth the reviewer's eyes. Then apply `lfad:move`'s push-stop rule: find the next applicable step. On the default board that is `review` (a `gate`) → **move the ticket forward to `review`**, where it waits in the needs-you row for the human's verdict; the `lfad:review` skill drafts the review packet there. This step runs no quality gates of its own — the review gate is where the diff and the automated signal (lint/typecheck/build/tests) are surfaced. Boards may define other gate or test steps after doing (via lfad:add-step) — respect them per the same push-stop rule.
