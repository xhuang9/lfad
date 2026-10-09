---
name: review
summary: The review gate — draft a review packet, let the human approve or send it back, route the ticket to done or doing.
description: >-
  The Review step playbook — the human gate between `doing` and `done`. A build stage lands here with its code in the worktree (committed or a clean dry-run diff); this skill drafts `review.md` — a review packet that makes the diff viewable, surfaces the automated quality signal (lint/typecheck/build/tests), and asks the human to confirm functioning / UI / important technical direction — then routes on their decision: Approve → the board's ship/done step, Reject → back to `doing` (lfad:build) carrying the comments. Tickets bounce `doing → review → doing → review` once per build stage. Auto-invoke when a ticket reaches or sits at the `review` step, when the user says "review ticket N", "draft the review", "approve the ticket", "send it back for changes", or runs /lfad:review. Movement mechanics defer to lfad:move.
---

# lfad:review — the review gate

The `review` step is the human gate between `doing` and `done`. `doing` builds a stage and, by default (`LFAD_DRY_RUN`), leaves the code **uncommitted in the worktree**; the ticket then waits here for a human. This skill turns the built stage into a **review packet** the human can act on, and routes the ticket on their verdict. All movement mechanics — board/daemon discovery, the `FLOW()` helper, the pull-validate + push-stop grammar, the question-block grammar — live in **`lfad:move`**; follow it for every board mutation. This skill defines only the review work.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

## What the human reviews (and what they don't)

The review **always surfaces a code review** — the diff must be viewable and the reviewer prompted to look. But code *quality* (style, micro-correctness) is carried by the **automated gate**: lint + typecheck + build + tests. Present those as the code-quality backstop so the human is not asked to read code line-by-line to catch what tooling already catches.

The human's decision slots focus on what tooling cannot judge:
- **Functioning** — does it do what the ticket asked; any bugs; any major UI defects.
- **UI** — does it look right (design tickets especially).
- **Important technical direction** — the high-impact calls worth a human: a new dependency, a changed UI/architecture standard, a change touching many surfaces, a change risking production data on deploy, or a change to a data-sync / migration path.

(A project may narrow the human's lens to taste — but the code diff and the automated signal always appear in the packet.)

## 1. Enter (pull-validate)

Per `lfad:move`, a ticket reaches `review` because `doing` finished a build stage and pushed it here. Before drafting, confirm the stage is actually reviewable:

- The `worktree` frontmatter path exists and holds the stage's work — **committed**, or a **clean, reviewable uncommitted diff** (dry-run default). Capture the diffstat: `git -C <worktree> status --short | wc -l` and `git -C <worktree> diff --stat | tail -1`.
- A `doing/` summary note exists describing what the stage built (files, behaviour, deviations).
- The **automated quality signal** is captured — the `doing/` notes record lint/typecheck/build/test results, or run the repo's gate now and record it. A red signal is a blocker, not a slot for the human.

Anything missing → do not draft an approval-ready packet; state plainly what is outstanding, and if code changes are needed send it back to `doing` (§4) rather than asking the human to approve incomplete work.

**Read `<ticket>/context.md` first** — the distilled brief — so the packet frames the change against what was decided.

## 2. Draft the review packet — `review.md`

Write `<ticket>/review.md` via `PUT /api/tickets/:id/artifact` (`{"name":"review.md","content":…}`; daemon down → write the file directly). **Honor the board's guidance and word every file by `../move/wording.md`** (language, tone; code/paths/commands stay English). Structure. Changed-file paths and git commands must be inline code so the board's shared click-to-copy treatment applies to both:

```markdown
# Review — <ticket title>  ·  stage <N> / <total>

## Brief
- <Git-commit-message-style change summary, itemised from the doing/ summary and commit messages>
- Technical notes: <important implementation choices, deviations, or constraints encountered along the way>

## The code (read this)
- Worktree: `<worktree path>`  ·  branch `<branch>`
- Changed files: `<relative/path/to/file>` · `<relative/path/to/other-file>`
- Diff: `git -C <worktree> diff`  ·  size <NN files, +A/-B>

## Automated quality signal (code-quality backstop)
- lint: <pass/fail> · typecheck: <pass/fail> · build: <pass/fail> · tests: <NN passed / 0 failed>
- Regression tests: <what was added / or why not — for your call>

## For your call

Summarise functioning / UI / any high-impact direction in prose here, then ask for the verdict. Keep it to **one approve question** by default — the reviewer approves or rejects and uses the built-in comment for any notes. Add a structured question ONLY when a specific fork genuinely needs the human to pick.

​```question
id: verdict
ask: Approve this stage? (Reject sends it back to doing — use the comment for the changes)
type: approve
​```
**Decision:**
```

Brief carries the change narrative that previously appeared as "What changed (from the doing/ summary, itemised)" under The code. Do not repeat it there: Brief explains what changed and why; The code stays a mechanical list of copyable relative paths and copyable git commands. Build Brief from both the `doing/` summary and commit messages so it captures the shipped behavior plus technical notes rather than merely restating filenames.

**Question types** (the `lfad:move` grammar owns the full spec):
- `type: approve` — Approve / Reject sign-off (the verdict). `single: true` → a lone Approve button.
- `type: option` + `options:` — pick exactly one (radio).
- `type: multi` + `options:` — pick any (checkbox).
- `type: text` — free text.
- Every one carries an **optional comment** (a `>` blockquote written under the Decision line) — so notes ride along with the answer; no separate "comment" question needed.

Reach for an extra `option` / `multi` / `text` question only for a real high-impact fork (a new dependency, a changed standard, a prod-data / sync-path call). Otherwise a lean one-approve packet respects the "as few human touches as possible" goal.

Put the stakes and any risk callouts in the prose **above** each question block (the board renders that as the question's context). If this stage carries a high-impact technical-direction call, name it explicitly there — do not bury it.

Then **complete in place** (a gate): the ticket stays at `review`; the human answers the slots on the board (the drawer's input mode at `/t/<id>/input`), and you route on their verdict (§3/§4).

On every exit route, rewrite the CURRENT-STATE block at the top of `<ticket>/context.md` per the canonical definition in `lfad:move`. Approval sets `Next action` to the next build stage or ship/done step; a Reject route sets it to the concrete change list the build agent tackles first. Restate the route's move reason in `Last action`, retain the branch/commit and review packet in `Pointers`.

## 3. Approve → advance

When the human answers `verdict = Approve` (and `functioning` is confirmed):

- **More build stages remain** → send the ticket back to `doing` for the next stage by running **`lfad:build`** (its pull-validate re-enters the worktree and builds stage N+1). Advance the stage marker (§5).
- **This was the last stage** → advance to the board's next step after `review`. If that step declares a **ship/done skill** (e.g. a project's `flow-ship`), run it — it owns merge/cleanup and the final move. If `done` is a bare `terminal` with no skill, move the ticket there directly with a reason (`FLOW move <id> done --reason "review approved — all stages done"`).

Never merge or move past `review` before the verdict is `Approve`.

## 4. Reject → back to doing

When the human answers `verdict = Reject` (or flags a functioning/UI/direction problem):

- Capture their comments as a concrete change list where the build agent will read it: append a `## Requested changes (round <k>)` section to `review.md` (or a `doing/NN-review-followup.md`).
- Move the ticket back to `doing` carrying the gist: `FLOW move <id> doing --reason "review round <k>: <one-line summary>"`. The worktree is reused (idempotent), so the build agent continues on the same branch.
- The build agent addresses the items, updates its `doing/` summary, and pushes back to `review` — where a **new review round** is drafted (bump the round; keep prior rounds for the audit trail).

A ticket may bounce `doing → review` several times before a stage is approved. Each round is cheap: only the delta is re-reviewed.

## 5. Build stages (multi-stage tickets)

`todo` divides a ticket into build stages **when the work warrants it** (a one-evening ticket is a single stage; a large ticket splits into reviewable increments — typically along the `todo/` chunk boundaries). Each stage is built in `doing`, reviewed here, and only then does the next stage build. So a 3-stage ticket walks `doing→review` three times.

**Stage state is data on the ticket** — model it in the ticket's `extras` frontmatter so it round-trips through moves and the board UI can render "stage X of N". The authoritative contract is `BuildStages` / `BuildStage` and `buildStagesSchema` in `packages/core/src/build-stages.ts` (exported by `@lfad/core` and `@lfad/core/build-stages`); the following is an authoring example of that contract:

```yaml
extras:
  buildStages:
    total: 3
    current: 2
    items:
      - { key: data-layer, title: "Data + sync", status: approved }
      - { key: ui,         title: "Modal UI",    status: review }
      - { key: polish,     title: "CSV + i18n",  status: pending }
```

`status` per item: `pending → building → review → approved` (or `changes` while bounced). On approve, mark the current item `approved` and advance `current`; on the last item's approval, the ticket advances to ship/done.

Use each item's canonical `key` to identify the corresponding chunk area(s); never write that identifier under `chunks` or another field name.

> `stages:` is a reserved alias for the board's **step** array (the columns) — never store build-stage data under a top-level `stages:` key; keep it under `extras.buildStages`.
