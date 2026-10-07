---
name: move
summary: The ticket movement grammar every flow skill follows.
description: The movement grammar for agent-dashboard tickets — how any agent finds the board and daemon, reads the steps, creates and moves tickets, passes human gates (the pull-validate + push-stop model), fast-passes inapplicable steps via stepNotes, and handles blocked tickets. Also the canonical definition of the question-block grammar (fenced `question` blocks + `**Decision:**` lines) that gates and blocked.md all share, plus the write-back procedure any agent uses to collect answers inline. Auto-invoke before creating or moving any agent-dashboard ticket, when advancing a ticket after finishing step work, when a ticket sits at a gate or in blocked, when the user says "move the ticket", "advance the ticket", "unblock the ticket", or runs /lfad:move. Every lfad:* step skill defers to this grammar for movement; step skills define the work, this skill defines how tickets travel.
---

# lfad:move — how tickets move through the board

**Skill names.** These skills are written with the default prefix, `lfad:<step>` (`lfad:move`, `lfad:build`), and refer to each other by that name. An install can pick its own prefix at setup (`node scripts/setup.mjs --prefix flow`); read every `lfad:` here as the prefix your skill list shows. In Claude Code a person or the board's copy button invokes a skill as `/lfad:<step>`; in Codex it is `$lfad:<step>`. A command shown with arguments, such as `/lfad:next <id>`, is the Claude Code form; Codex takes the same arguments after `$lfad:next`.

One grammar governs all ticket movement. Step skills own *what* each step does; this skill owns *how* a ticket enters a step, when it advances, and where it stops. Two invariants anchor everything:

1. **The filesystem is the single source of truth** — a ticket's `status` always equals the step folder it lives in, and every mutation goes through the daemon (REST) or the `flow` CLI, never hand-edited folder moves.
2. **While the daemon runs, it is the board's sole committer** — route every write through REST so its serial git-snapshot rule holds. Use the CLI only when the health probe fails.

## Find the board and the daemon

```bash
# The board is per-project data: LFAD_BOARD, else .agent-dashboard, else a board made before the rename (.flow).
BOARD="${LFAD_BOARD:-$HITLOOP_BOARD}"
if [ -z "$BOARD" ]; then
  if [ -d "$PWD/.flow" ] && [ ! -d "$PWD/.agent-dashboard" ]; then BOARD="$PWD/.flow"; else BOARD="$PWD/.agent-dashboard"; fi
fi
# The tool: LFAD_HOME, else inside the board (.lfad, or .hitloop on older boards), else a sibling folder.
HOME_DIR="${LFAD_HOME:-$HITLOOP_HOME}"
if [ -z "$HOME_DIR" ]; then
  for d in "$BOARD/.lfad" "$BOARD/.hitloop" "$PWD/lfad" "$PWD/hitloop"; do [ -d "$d/packages" ] && HOME_DIR="$d" && break; done
fi
PORT="${LFAD_PORT:-${HITLOOP_PORT:-4319}}"
BASE="http://localhost:$PORT"
curl -fsS "$BASE/api/health"                          # {"ok":true} → REST is the path
```

Every lfad skill that needs the board, the tool or the port resolves them with this block. Older installs still work: `HITLOOP_*` variables are read when the `LFAD_*` ones are unset.

- Health probe answers → use REST for everything below.
- Health probe fails → the daemon is down; use the CLI at `node "$HOME_DIR/packages/runtime/dist/cli.js"`. If `HOME_DIR` is empty, ask the user where the tool is. The ticket subcommands resolve the board from `LFAD_BOARD`, so prefix the env var to stay cwd-independent:

```bash
FLOW() { LFAD_BOARD="$BOARD" node "$HOME_DIR/packages/runtime/dist/cli.js" "$@"; }
```

## Running claim protocol (canonical)

Before an official session does ticket work, its pre-work check is one atomic claim request — never a read-then-lock pair:

```bash
CLAIM=$(curl -fsS -X POST "$BASE/api/tickets/$ID/claim" -H 'content-type: application/json' \
  -d "{\"label\":\"${AGENT_LABEL:-agent session}\"}")
RUNNING_TOKEN=$(printf '%s' "$CLAIM" | jq -r .token)
```

- A `409` means another valid official session holds the ticket. **Stop by default** and report the returned `holder` (`count`, `claimedAt`, optional `label`). Tell the operator they can wait for the lease TTL, use the drawer's **Clear running** action to discard stale claims, or explicitly authorize a deliberate concurrent run and retry the claim with `{"force":true,"label":"..."}`. Never force implicitly.
- Keep the opaque token private to this run. At every step/checkpoint boundary, heartbeat it with `POST /api/tickets/:id/heartbeat` and `{"token":"..."}`. A `404` means the lease expired or was cleared; stop and claim again rather than continuing invisibly.
- Release with `POST /api/tickets/:id/release` and `{"token":"..."}` on **every** success, error, gate, terminal, and block exit. Release is idempotent, so install cleanup/trap handling where the host supports it and still release explicitly at normal chain stops.
- A `lfad:next` chain owns one claim across the whole chain: heartbeat between dispatched steps and release only when the chain stops. Nested step skills reuse that claim; they do not acquire competing claims.
- Claims are daemon-memory-only. When the health probe fails there is no shared lease service; state that advisory protection is unavailable and continue with the existing CLI fallback.

## Read the board

| What | REST | CLI |
|---|---|---|
| Pipeline steps, in order | `GET /api/steps` | read `<board>/board.yml` |
| All live tickets | `GET /api/board` | list the step folders |
| One ticket + its artifacts | `GET /api/tickets/:id` | `FLOW show <id>` |

`/api/steps` returns `{key,label,folder,lateral,type,row,position,entry}` per step — plus per-step `guidance` and the board-level `guidance` when `board.yml` sets them. **`type` is the routing truth**: `agent` (agents work and advance) · `gate` (a human decides; complete in place) · `queue` (pass-through, no run) · `terminal` (the pipeline ends). A step is a human gate exactly when `type` is `"gate"`. The lateral `blocked` step is appended last. `parked` and `_archive` are built-in independent stores, never pipeline steps and never listed here.

The default pipeline reads:

```
idea → research → interview → mock? → design? → todo → doing → review → done      (+ blocked lateral, _archive cold store)
                  gate        gate    gate                    gate     terminal
```

Two rows: **agents** = research / todo / doing / done; **needs-you** = idea / interview / mock / design / review. `mock` and `design` carry `skipUnless: needsDesign` — they apply only to tickets whose `needsDesign` frontmatter flag is truthy (lfad:idea sets it for `ui`-category tickets). Boards grow from there via lfad:add-step — always read the live steps rather than assuming this lineup.

> **`_archive` is every board's true end-of-line.** The diagram labels `done` `terminal` because on this *default* lineup `done` is the last configured step, so wrapping up is simply `done → _archive`. But a board may define **steps after `done`** — read the live tail via `GET /api/steps`. When it does, `done` is a visible **resting / landing column**, not the terminal, and a shipped ticket resting there is **not finished**: an agent or operator wrapping up **must carry it onward through those steps to `_archive`**, one explicit `lfad:next` per hop, never auto-chained. Decide this from the live pipeline, not the diagram: a `type: agent` step with no `skill` (a resting `done`) that has steps after it is not terminal. Simple boards where `done` is the last step are unaffected — there `done` is terminal and `_archive` is the only post-terminal move.

## Create a ticket

```bash
# REST
curl -fsS -X POST "$BASE/api/tickets" -H 'content-type: application/json' \
  -d '{"title":"Fix login","category":"bug","tags":["auth"],"body":"What & why"}'
# CLI
FLOW create "Fix login" --category bug --tags auth,ui --body "What & why" --step todo
```

Categories: `ui|bug|logic|business|refactor|hotfix`. Omit `--step`/`entryStep` to enter at the board's default entry step. The REST payload also accepts `"needsDesign": true` (custom frontmatter flags round-trip safely through moves).

## Move a ticket

Always move with a **reason** — it lands in the ticket's log and is the audit trail the human reads.

```bash
# REST
curl -fsS -X POST "$BASE/api/tickets/12/move" -H 'content-type: application/json' \
  -d '{"toStep":"doing","reason":"gates cleared — starting implementation"}'
# CLI
FLOW move 12 doing --reason "gates cleared — starting implementation"
```

Both surfaces reject unknown ids/steps with a readable message (the CLI exits non-zero) — surface that message and stop rather than retrying blindly.

## The CURRENT-STATE block (canonical)

Every ticket's root `context.md` starts with one always-current handoff block, directly under the title. Every artifact-writing step rewrites this block on exit; it **supersedes the previous block in place** — never append another block or turn it into narrative history. `lfad:move` defines the convention but has no rewrite duty because it writes no step artifacts.

```markdown
## CURRENT STATE

- Status: <current step> — <where things stand>
- Last action: <what just happened; restate the step's move reason>
- Next action: <what the next agent does first>
- Pointers: <branch> · <commit> · <key files/artifacts a resumer needs>
```

Keep each field to about one line; overflow detail belongs in the step's own artifact. This is a compactness guideline, not a numeric cap or lint gate: reliable, high-quality resumption outranks token savings. Step skills point to this definition rather than restating it.

### Any direction, and a backward move preserves downstream artifacts

A move is valid to **any step, forward or backward** — the engine imposes no forward-only rule (`moveTicket()` / `relocateTicket()` in `packages/core/src/fileops.ts` only rename the ticket folder and mutate `status` / `history` / `updatedAt`; `assertValidTicket()` has no step-order constraint). A **backward move preserves the ticket's downstream artifacts**: every artifact (`research/`, `interview/`, `mock/`, `design/`, `doing/`, …) lives inside the ticket folder, so on the rename it travels along untouched and stays visible — moving `design → interview` keeps the `design/` and past `interview/` files in place. Nothing reads, warns about, or clears them; re-running the re-opened stage is what refreshes it, and `lfad:next` still won't advance past that stage's unanswered gate.

There is no dedicated "move to any step" UI control. The human-facing way to trigger an ad-hoc move-to-any-step — jump ahead, redo a stage, correct a wrong path — is a freeform **`lfad:prompt`** ("move this back to interview and re-open the questions"); that skill performs the move through this grammar after recording the exchange (see `lfad:prompt`).

## The question-block grammar (canonical)

Every question an agent leaves for the human — in a gate's step files, in `blocked.md`, anywhere on the ticket — uses **one format**. The engine parses it (`questions[]` / `openInputs` in the board and ticket payloads), and the board UI collects answers through it (input mode at `/t/<id>/input`, the amber "? n" badge). lfad:interview, lfad:mock, lfad:design, and any skill that asks the human anything all write this grammar; none redefines it. There is no separate "collect answers" skill: the human answers on the board, or — when a user is present in a session — the agent working the ticket asks the open blocks inline and writes the answers itself (see *Collecting answers*).

A question is a fenced code block with info string `question` holding YAML fields, followed (within the next few lines) by a `**Decision:**` line:

````markdown
```question
id: q1
ask: Should settings live on their own page or in a modal?
type: option
options:
  - Own page
  - Modal over the current view
```
**Decision:**
````

- Fields: `id` (stable, unique within the ticket) · `ask` (the question, one line) · `type` (`approve` | `option` | `multi` | `text`) · `options` (for `option` / `multi`) · `single` (on `approve`, `true` = a single Approve button, no Reject).
  - **`type` meanings** — `approve`: Approve / Reject sign-off · `option`: pick exactly one of `options` (radio) · `multi`: pick any of `options` (checkbox; the answer joins the picks with `, `) · `text`: free text. Legacy `choice` and `confirm` still parse — they normalize to `option` and `approve`.
- An **empty** `**Decision:**` line = an OPEN input. A bare empty `**Decision:**` line with no fence also counts (legacy format — the plan-era docs).
- **Answer format** — the exact bytes the board's input form writes: `**Decision:** <answer> ·YYYY-MM-DD` (one line; the `·` date stamp trails the answer). The board form, a hand edit, and an agent collecting inline all write the same line, so any channel's answer looks identical. An **optional comment** (the human's extra note) follows as one or more `>` blockquote lines directly beneath the Decision line; re-answering replaces that block rather than stacking a new one.
- **Comment-only answer** — for `option` / `multi`, submitting a typed comment with no option picked records that comment AS the answer: its single-line-collapsed form fills the Decision line (so the gate resolves) while the full comment is kept as the `>` block beneath.
- The markdown **between the previous question and this one is the question's context** — the UI shows it above the form. Put the evidence and the fork's stakes there, not inside the YAML.
- `blocked.md` uses the same grammar: an escalated question renders as a question block with an empty Decision line, and the human's answer lands on that line. (An older `blocked.md` may carry only a `**Question:**` line — answer in chat or append a `**Decision:**` line yourself.)

### Collecting answers (any channel)

There is **no separate answer-collector skill.** The human answers on the board (input mode), or — when a user is present in your session — **you** collect the open blocks inline as part of whatever you're doing to the ticket. Either way the write-back is identical, and it is the only safe way to write a Decision line:

1. `GET /api/tickets/:id` for a fresh payload (never work off a stale one), and read `questions[]` — each open block carries `file`, `ask`/`context`, and `decisionLine`.
2. Present the open blocks in `questions[]` order, one at a time, with their context; take the human's answer (and any comment). "Skip / I don't know" leaves the line empty — never invent an answer or write a placeholder.
3. Re-locate the block in the fresh payload (match by `id`, then `ask`, then `decisionLine`/`context`) and rewrite **only** that `**Decision:**` line to `**Decision:** <answer, one line> ·YYYY-MM-DD` (+ optional `>` comment lines beneath). `PUT /api/tickets/:id/artifact` with `{"name":"<file>","content":"<full updated content>","baseContent":"<the content you edited>"}` — `baseContent` makes the write conditional; a `409` means the file changed underneath, so re-fetch and retry. The PUT response carries the refreshed `questions[]` — advance from there.

Collecting answers **never moves the ticket** — answering is what resolves gates; the next step's pull-validate does the moving.

## The gate model: pull-validate + push-stop

Humans approve by **answering a gate's question blocks and approval slots** in its step files (on the board, or inline with the agent working the ticket — see *Collecting answers*), and agents do all the moving. Two rules make that safe:

### Entering a step (pull-validate)

1. `GET /api/steps` and `GET /api/tickets/:id` (ticket + artifacts + `questions[]`).
2. Walk **backwards** from your target step through the pipeline order and find every `gate` step that applies to this ticket (skip steps whose `skipUnless` flag is falsy on the ticket and steps fast-passed in `stepNotes`).
3. Read each gate's evidence from the ticket's artifacts — a gate's evidence is that step's **file set**: every markdown file in the gate's step subfolder (e.g. `interview/00-summary.md` …), or a legacy single-file artifact when that is what exists. The gate is **resolved** when every question block and bare `**Decision:**` line across those files carries an explicit answer, **and** any completion mark the gate's own skill defines holds (interview: the latest round records `Clarity` at or above its threshold; mock/design: the `## Approval` slot answered).
4. All applicable gates resolved (or none exist) → move the ticket into your step with a reason (e.g. `"interview gate cleared — starting the breakdown"`) and begin the step's work.
5. Any gate unresolved → stop **before** doing any step work and surface exactly which questions await the human: inside a daemon run print `FLOW_BLOCK: <one-line question>`; in an interactive session, collect the answers inline (see *Collecting answers*) or point the user at the board.

### Finishing a step (push-stop)

1. Write your step's files first; movement comes after the work is durable.
2. Your own step is a `gate` or `terminal` → **complete in place.** The ticket stays put; the human answers the step files' question blocks on the board (or inline with the agent working the ticket), and the *next* step's pull-validate is what carries the ticket forward. (A step skill may also declare its own complete-in-place semantics — lfad:todo does: `todo` is the ready queue, and the doing worker pulls from it.)
3. Otherwise, find the next applicable step in pipeline order (same `skipUnless` / fast-pass skipping as above) and **move the ticket forward with a reason — whatever the next step's type**. A `gate` next means the ticket now waits *at* that gate in the needs-you row: its gate skill drafts the gate content there and the human resolves it there (e.g. research finishing moves the ticket to `interview`, where it waits). An `agent` or `queue` next means the next worker (or autopilot) picks it up; a `terminal` next ends the pipeline.

## Fast-pass: a step that does not apply

Record the judgment instead of silently skipping, so the board shows *why* a step was passed over:

```bash
# REST — preferred while the daemon answers /api/health
curl -fsS -X POST "$BASE/api/tickets/12/note" -H 'content-type: application/json' \
  -d '{"step":"checks","skip":true,"reason":"config-only change; nothing to gate"}'
# CLI — the daemon-down fallback
FLOW note 12 --step checks --skip --reason "config-only change; nothing to gate"
```

Both set `stepNotes.checks = { applicable: false, reason }` on the ticket — a `ticket.md` modification, so either surface snapshots the pre-change board first. Then apply the push-stop rules as if the step were done. Fast-passing is for work steps — a `gate` is fast-passed only when the human says so; `mock`/`design` need no fast-pass for non-design tickets because their `skipUnless` flag already skips them.

Quality gates follow the same principle: a checks/test step runs **only when the board defines one** (the default lineup has none); when it exists and applies, run it, and when it exists but does not apply, fast-pass it with the recorded reason.

## Blocked tickets

- **In a daemon run**, escalate a decision by printing `FLOW_BLOCK: <one-line question>` on its own line — the daemon moves the ticket to the lateral `blocked` step, writes `blocked.md` (question-block grammar above), and records the origin step in the ticket's `returnStep` field. In an interactive session, ask the user directly instead.
- **To resolve a block** after the human has answered (the `Decision:` line in `blocked.md`, the board's input mode, or chat): move the ticket back to its recorded `returnStep`, carrying the answer in the reason — this is exactly what core's `resolveBlock` does, and a move to any non-blocked step clears `returnStep` automatically.

```bash
FLOW move 12 doing --reason "human decided: keep the existing schema, add a nullable column"
```

## Parked tickets

`parked/` is a built-in resumable holding store, not a configured step or rendered board column. Park a live pipeline ticket with `POST /api/tickets/:id/park` (daemon down: `FLOW park <id>`). This records the current step in `returnStep`, changes `status` to `parked`, and removes the ticket from `GET /api/board` into `GET /api/parked`. Restore with `POST /api/tickets/:id/unpark` (daemon down: `FLOW unpark <id>`): it returns automatically to `returnStep`, falling back to the board entry step if that origin was removed. Park/unpark are moves, so they do not snapshot the board; while the daemon runs, REST remains the sole mutation path.

## Who commits the board

- The board (`.agent-dashboard`, or `.flow` on older boards) is its own git repo, and the running daemon is its **sole committer**: modifications to existing ticket content snapshot the pre-change board first; moves and new tickets change no history.
- The CLI applies the same snapshot semantics on the daemon-down path (`flow note` snapshots; `flow create`/`flow move` do not), so either path leaves an identical git story.
- Agents commit **code** inside their per-ticket worktree of the code repo — the board's git belongs to the daemon/CLI alone.
