---
name: todo
summary: Break the cleared gates' outcome into agent-ready, user-testable chunks.
description: >-
  The Todo step playbook — pull-validate the upstream gates (interview cleared with zero open question blocks and Clarity at/above threshold; mock and design each approved or skipped), move the ticket to todo, then break the work into areas and executable chunks a sub-agent can pick up independently: every chunk user-testable (no pure-plumbing slices), parallel chunks touching disjoint files, dependencies a DAG, the test seam decided now. Reads context.md FIRST, and the todo/ breakdown set carries ALL upstream detail forward — decisions, constraints, and risks travel as plain final state, never summarized away. The result stays at todo: that status means "fully ready for an agent to action", and the doing worker pulls it forward. Auto-invoke when a ticket is ready for breakdown, when the user says "break down ticket N", "todo ticket N", "prepare the ticket for agents", "chunk the work", or runs /lfad:todo. Movement mechanics defer to lfad:move.
---

# lfad:todo — the breakdown

Todo converts the cleared planning gates into work a no-context agent can execute. Input: **`context.md` first**, then the ticket body and the `interview/` set (plus `mock/`/`design/` when they applied, and `research/` for the paths). Output: the **`todo/` breakdown set** — the execution breakdown. Two rules dominate everything below: **every chunk is user-testable**, and **no information from the upstream steps is lost on the way**.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

**Write every file by `../move/wording.md`, which layers the board's `writing`, `guidance` and `localRules` over the plugin defaults**.

## Enter: pull-validate the gates

Apply the **pull-validate** rule from `lfad:move` — walk backwards from todo through every gate that applies to this ticket:

- **design** and **mock** (each only when it applies — its `skipUnless: needsDesign` flag truthy and not fast-passed in `stepNotes`): the step folder's `## Approval` slot carries an explicit answer, along with every other question block in the set.
- **interview** (always): **zero open question blocks** across the `interview/` files, AND the latest round in `00-summary.md`'s round log records **Clarity at/above the threshold (~80%)**.

All resolved → move the ticket into todo with a reason (`"gates cleared — starting the breakdown"`) and begin. Anything open → stop before doing any breakdown work and surface exactly which questions await the human (interactively, collect them inline per `lfad:move`'s *Collecting answers* or point the user at the board; in a daemon run print `FLOW_BLOCK: <one-line question>`).

Honor the resolved decisions literally — a rejected recommendation means break down the human's written alternative. **Read `context.md` before pulling the step artifacts**: it is the distilled brief; the artifacts are the detail behind it.

## Zero information loss

The `todo/` set is what the build agent works from, alongside `context.md` and the gate file sets. Carry **all** upstream detail forward into it:

- Every resolved decision — the human's answers and the interview's `Resolved by agent` lines — lands in the breakdown as **plain final state** ("Use a nullable column; no backfill migration"), stated where the executing agent needs it — never as history ("the human rejected q2, so…") and never summarized away.
- Every constraint, risk, and scope boundary from the interview (and the approved mock/design contracts — file paths included) reappears in the chunk(s) it governs. A constraint that applies everywhere goes in `00-breakdown.md` once.
- When the breakdown surfaces something the gates never decided, that is a gap, not a judgment call: interactively ask the user; in a daemon run print `FLOW_BLOCK: <one-line question>`.

The test: a sub-agent handed `context.md` + the `todo/` set and nothing else can implement any chunk without asking what was decided.

## Chunking rules

1. **Every chunk stays user-testable.** Each chunk ends in something a human can exercise — a visible behavior, a callable endpoint, a runnable test. Before accepting a chunk, answer: *what can the user do, see, or get a bug report about after this chunk ships?* If the answer is "nothing", merge it into its consumer.
2. **No pure-plumbing slices.** Helpers, types, flags, and migrations ship inside the first chunk that exercises them — even when that makes the chunk bigger.
3. **Areas first, chunks second.** Group the work into 2–4 areas (data layer, API, UI, …), then cut each area into chunks an agent completes in one sitting.
4. **Parallel chunks touch disjoint files.** Two chunks that modify the same file are either merged or sequenced. Dependencies form a DAG — foundations first, consumers fan out after.
5. **Each chunk is self-contained for execution.** Goal, exact file paths, the code shapes that matter, step-by-step actions, which tests to write or extend, and a done-criteria/verify line. Reference `00-breakdown.md` for shared detail instead of repeating it.
6. **Decide the test seam now.** Prefer an existing seam over a new one, the highest seam that still gives a fast deterministic signal, and as few seams as possible (ideally one). Name it in `00-breakdown.md` so the build agent writes tests against it instead of improvising coverage.

## Build stages: seed the marker

Build stages are a standard **optional** output of todo. Use them only when the breakdown genuinely warrants separate review passes — a multi-chunk ticket whose areas form natural, independently reviewable boundaries. A single-pass or single-chunk ticket needs no marker; do not manufacture stages merely because the feature exists.

When stages do help, seed the marker that `doing` and `review` consume. The authoritative contract is `BuildStages` / `BuildStage` and `buildStagesSchema` in `packages/core/src/build-stages.ts` (exported by `@lfad/core` and the browser-safe `@lfad/core/build-stages` subpath). Author it with this exact shape:

```yaml
extras:
  buildStages:
    total: 3
    current: 1
    items:
      - { key: core, title: "Core contract", status: pending }
      - { key: runtime, title: "Runtime warnings", status: pending }
      - { key: ui, title: "Tolerant UI", status: pending }
```

- Add one item per reviewable stage, in build order. `total` must equal `items.length`; initialize `current` to the 1-based index `1`.
- `key` is the stable, concise identifier that maps the stage to its chunk area(s); `title` is the human-readable review label. Never substitute another field such as `chunks` for `key`.
- Initialize every item with `status: pending`. The allowed lifecycle values are `pending`, `building`, `review`, `approved`, and `changes`; `doing` and `review` advance them.
- Keep stages coarse enough that each pass delivers a coherent, testable increment. Sequence stages whose files or behavior depend on earlier stages.

## The todo/ file set

Write this step's outputs as markdown files inside the ticket folder at `<ticket>/todo/NN-{slug}.md` — numbering from `00`, next free NN. Decompose like a planning folder (shared context first, then one file per area) rather than one monolith; a step folder holding 2+ files MUST have its `00-…` entry point. Put images in `<ticket>/images/` and reference them relatively (from a todo file: `../images/name.png`). Everything you write appears in the board's content rail, grouped under the todo step.

- **`00-breakdown.md`** — the shared context and the dependency order.
- **`NN-<area>.md`** — one file per area, holding that area's chunks. Number chunks globally across the set (chunk 1, 2, … unique over all files) so the dependency order reads unambiguously.

`00-breakdown.md`:

```markdown
# Todo — <ticket title>

## Context (applies to every chunk)
- <Decisions from the gates as final state, one line each>
- <Constraints and risks that govern the whole ticket>
- Test seam: <where tests hook in — unit function / API boundary / e2e flow>

## Dependency order
1 → 2 ‖ 3 → 4        <chunks 2 and 3 run in parallel after 1; 4 last>
```

`NN-<area>.md` (one per area):

```markdown
# <Area> — chunks

### 1. <Area — chunk name>
- Goal: <what exists after this chunk, in user-visible terms>
- Files: `path/to/file` — <what changes>
- Steps: <the concrete actions, in order>
- Tests: <which tests are written or extended, against the named seam>
- Verify: <how a human sees/exercises this chunk working>

### 2. …
```

Keep the chunk count honest — a one-evening ticket is often a single chunk (its set may honestly be `00-breakdown.md` with the one chunk inline); forcing more slices than the work has seams creates plumbing, and rule 2 forbids that.

## Write the files, then rewrite context.md

Write each todo file via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"todo/00-breakdown.md","content":…}` — the route accepts nested paths and creates the `todo/` folder); daemon down → write the files into the ticket folder directly (a new artifact file needs no snapshot, matching the CLI semantics in lfad:move).

Then — the todo-written boundary — **fully rewrite `<ticket>/context.md`** (never append): English, ~150-line hard cap, only paths/symbols/settled decisions/hard constraints, no prose history. Include the CURRENT-STATE block at the top per the canonical definition in `lfad:move`, rewritten for the todo exit and the doing worker's first action. After todo it typically reads as the whole-ticket brief: the settled decisions, the governing constraints, the test seam, and the file paths the chunks touch.

## Finish: complete in place

The result **stays at todo** — that status is the board's ready queue and means "fully ready for an agent to action". The doing worker (lfad:build) applies its own pull-validate and moves the ticket to `doing` when it starts; this skill never pushes it there. When the board defines a gate immediately after todo, the standard push-stop rule from `lfad:move` gives the same answer: stay put. State plainly in your output that the breakdown is ready and where the `todo/` set lives; in a daemon run, signal per the run prompt's sentinel protocol (`FLOW_DONE` after the files are written).
