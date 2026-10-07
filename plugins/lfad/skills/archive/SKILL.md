---
name: archive
summary: Cold-store a finished ticket and clean up its worktree and branch.
description: >-
  The archive playbook — move a done ticket into the system `_archive` cold store (a lateral holding area, never a rendered board column), then clean up its footprint: remove the ticket's git worktree, delete its branch once merge-base confirms the work is merged, and report anything undeletable. Also reactivates an archived ticket back into a live step. Auto-invoke when the user says "archive ticket N", "archive the done tickets", "clean up the done column", "cold-store finished work", "reactivate ticket N", "bring back the archived ticket", or runs /lfad:archive. Movement mechanics defer to lfad:move.
---

# lfad:archive — retire finished tickets

`_archive/` is a **system directory**: a cold store next to the step folders, never listed in `board.yml` and never rendered as a column. Archiving keeps the board scannable — `done` shows recent wins; `_archive` holds history. An archived ticket keeps its folder, artifacts, log, and last `status`, so nothing is lost and everything is recoverable.

`parked/` is distinct: it is a live-intent holding store for work deliberately set aside and expected to return. Parked tickets carry `status: parked` plus `returnStep`, appear in the Parked view, and Restore automatically to their origin. Never use archive for temporary deferral or parked for completed cold storage.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes — the health probe, `BASE`, `BOARD`, `HOME_DIR`, and the `FLOW()` helper. While the daemon answers `/api/health` it is the board's sole committer, so route every write through REST; fall back to the CLI only when the probe fails.

## When to archive

- The ticket sits at its **last applicable configured live step** and its work is shipped — on a code ticket, the branch is merged. On a simple board this is normally terminal `done`; on a board that defines steps after `done`, `done` is a **resting / landing column** and `_archive` is the true end-of-line, so the ticket must complete its applicable post-`done` steps first.
- Applicability follows the ticket's `skipUnless` flags and recorded `stepNotes.<step>.applicable: false` fast-passes. The REST and CLI archive entry points enforce this invariant; a human instruction cannot bypass it by archiving from an earlier live step.

## 1. Archive the ticket

Archiving is a **move** into `_archive/` — never hand-commit the board or call core directly while the daemon runs. Route it through the daemon so its git-snapshot rule, index rebuild, and SSE broadcast all fire; use the CLI only when the health probe fails.

```bash
# REST (daemon up) — the reason lands in the ticket log
curl -fsS -X POST "$BASE/api/tickets/12/archive" -H 'content-type: application/json' \
  -d '{"reason":"shipped and merged"}'
# CLI (daemon down) — same move, same (no-)snapshot semantics
FLOW archive 12 --reason "shipped and merged"
```

Either surface first verifies that the ticket is at its last applicable configured live step, then relocates the ticket folder into `_archive/`, logs the reason, and (over REST) rebuilds the index + broadcasts — so the ticket leaves `GET /api/board` (which lists live tickets only) and the rendered board. A premature archive is rejected with an error naming the current and required steps without moving or logging the ticket. An unknown id returns 404; an already-archived ticket is rejected with a readable message — surface the error and stop rather than retrying.

## 2. Remove the worktree

```bash
FLOW worktree remove 12
```

The primitive reads the ticket (it finds archived tickets too), removes the `t-<id>` worktree directory, prunes the git registration, and clears the `worktree` frontmatter field. It is a safe no-op when no worktree exists or `LFAD_CODE_REPO` is unset.

## 3. Delete the merged branch (safety net — ship deletes it first)

Branch deletion primarily happens at **ship/done** (the ship skill deletes the merged branch right after merge). This step is the **idempotent safety net**: by the time a ticket is archived the branch is usually already gone, so this is normally a no-op — run it only to catch a branch a ship missed.

The branch name follows lfad:build's convention (`<prefix>/<id>-<slug>`, e.g. `bugfix/12-login-timeout`); confirm it via `git -C "$REPO" branch --list "*/12-*"` when in doubt. Delete **only after merge-base confirms the work is merged**, and use `-d` (never `-D`) so git double-checks:

```bash
REPO="${LFAD_CODE_REPO:?}"        # or read codeRepo from GET /api/info
MAIN="$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
git -C "$REPO" merge-base --is-ancestor "bugfix/12-login-timeout" "${MAIN:-main}" \
  && git -C "$REPO" branch -d "bugfix/12-login-timeout"
```

- Merge-base fails (the branch is not an ancestor of the default branch) → the work never landed. **Keep the branch**, tell the user plainly, and treat the archive as suspect: a done-but-unmerged ticket usually wants the user's call before it disappears into cold storage.
- The branch is checked out elsewhere or otherwise undeletable → leave it and report it; a leftover branch is a note, never a reason to force.

## 4. Report

Close with a factual summary: ticket id + title archived, worktree removed (or none existed), branch deleted (or kept, and why). Anything undeletable is named explicitly so the user can act on it later.

## Reactivate: back to a live step

To pull a ticket out of cold storage, route the reactivation through the daemon the same way — REST while `/api/health` answers, the CLI when it does not. `reactivateTicket` sets `status`, pushes a `history[].step` entry, and clears `returnStep` (reactivating into any non-blocked step):

```bash
# REST (daemon up) — omit toStep to resume at the step it was archived from
curl -fsS -X POST "$BASE/api/tickets/12/reactivate" -H 'content-type: application/json' \
  -d '{"toStep":"done","reason":"archived prematurely"}'
# CLI (daemon down) — --step defaults to the archived-from step when omitted
FLOW reactivate 12 --step done --reason "archived prematurely"
```

A ticket that is not archived is rejected with a readable message; an unknown id returns 404. Choose the target step from the live pipeline (`GET /api/steps`) by where the ticket actually resumes: back to `done` when it was archived prematurely; to an earlier step (e.g. `todo` or `doing`) when the work reopens — and from there the normal lfad:move grammar (pull-validate on entry, push-stop on finish) governs it again. Recreate a worktree only when build work resumes; lfad:build provisions it per its own branch policy.

## Finish

Archive is the end of the line — `_archive` sits past `terminal`, so there is nothing to push forward and push-stop is trivially satisfied: **complete in place** and report. A reactivated ticket re-enters the pipeline at its target step, and the next skill to touch it follows lfad:move from there.
