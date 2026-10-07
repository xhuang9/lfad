---
name: next
summary: The one universal action — read the ticket's current step and do whatever that step needs, chaining through agent steps until a human gate.
description: The single "Next" action for a ticket — the operator never picks a step-skill (build/review/todo/ship/…); they click one button that copies `/lfad:next <id>`, and this skill inspects the ticket's current status and dispatches to the right step logic. Agent steps run and advance; a fresh gate gets drafted; an answered gate is processed and the ticket advances; it chains through consecutive agent steps and stops at the next human gate, terminal, or block. Auto-invoke when the user runs /lfad:next, pastes a "next"/"process" command, or says "advance ticket N", "process ticket N", "move ticket N forward", "what's next for N". Movement mechanics and the gate/question grammar defer to lfad:move.
---

# lfad:next — process the ticket from wherever it is

One action drives the whole board. The operator does not choose between `lfad:build`, `lfad:review`, `lfad:todo`, `flow-add-test`, `flow-ship`, … — they click **Next** (which copies `/lfad:next <id>`) and this skill figures out what to do **from the ticket's current step**. It is a thin router: it reads the step's `skill` binding from `board.yml` and **delegates to that step's skill** — it never re-implements a step. Board/daemon discovery, the pull-validate + push-stop grammar, and the question grammar all live in **`lfad:move`**; follow it.

Acquire the ticket's running claim at the start using `lfad:move`'s canonical protocol. A 409 stops this run and reports the holder plus wait/Clear-running/explicit-force options. Hold one token across the chain, heartbeat between every dispatched step, and release it on the gate, terminal, block, success, or error where the chain stops.

## Dispatch

1. Resolve the board/daemon per `lfad:move`. `GET /api/tickets/:id` → the ticket's **`status`** (its current step key) plus structured **`manualTasks[]`**. `GET /api/steps` → that step's **`type`** and bound **`skill`**.
   - **Pending manual task guard** — inspect the fresh detail payload before dispatching any step. If one or more `manualTasks[]` entries have `done: false`, stop the chain in place: report their ids/titles, tell the human to complete them from the drawer's **Manual tasks** view, release the running claim, and stop. Do not run the current skill or move the ticket. Completed-only and no-task tickets continue normally.
2. Route on the step's `type`:

   - **`agent`** — two cases:
     - **has a `skill`** (research / todo / doing / add-test / doc / …) → **run it**, do its work; it advances via push-stop; **continue the chain** (step 3).
     - **no `skill`** (a bare resting/landing column, e.g. a shipped `done`) → it is a **chain STOP**. If you *chained into* it this run → report the ticket landed there and **stop** (a real-world human action happens here — push/deploy). If the ticket was **already** at this step when this Next was invoked → **advance** to the next step and dispatch it (this is the deliberate "move it onward" Next).

   - **`gate`** (interview / mock / design / review / any project gate) → the human decides here. Read the gate's file set + `questions[]`:
     - **Not drafted** (no step files / no question blocks yet) → run the gate's skill to **draft** the packet so the human has something to answer. Stop; tell the human what to answer.
     - **Drafted, questions still OPEN** → **do not advance**. Report exactly which questions await the human (they answer via the drawer's question flow — the "N questions" button / input mode at `/t/<id>/input`), and to run **Next** again once answered.
     - **Resolved** (every question block / approval slot answered) → **process** the answers per the gate's skill, then **advance** to the next applicable step and **dispatch that** (recurse into step 2). One click carries the ticket as far as it can autonomously go.

   - **`terminal`** (a shipped `done` on a plain board) → if it has a ship skill and isn't shipped yet, run it and stop (rest at done). If it is **already shipped** and the ticket was already here when this Next was invoked → **archive** it (§Archive). Otherwise report done. Stop.

   - **`blocked`** (lateral) → the escalated question is answered → move back to `returnStep` carrying the answer (per `lfad:move`) and dispatch; still open → report what the human must answer. 

   - **`parked`** (system holding store, never a pipeline step) → Restore via `POST /api/tickets/:id/unpark` (CLI fallback: `flow unpark <id>`). Restoration returns automatically to `returnStep`; do not dispatch or chain further in the same Next.

3. **Chain until a human is needed.** Keep advancing through consecutive skill-bearing **agent** steps (e.g. `todo → doing`, or `review`-approved → `add-test → ship`) and **stop** at the first of: a **gate with open questions**, a **bare resting / shipped `done`**, a **terminal**, or a **block**. Never blow past a human gate, and never auto-archive (see below).

## Archive — every board's end-of-line

`_archive` is the system cold store (gitignored history), never a rendered column. Archiving is the **default final move for every board** and a **plain status change** — the worktree was already removed at ship, so nothing else runs.

- Once a ticket has cleared the **last configured step** — a shipped `done` on a plain board, or (on boards with a post-done step, such as a `doc` step) once that step finishes — an explicit **Next archives it**: run the board's archive skill (`lfad:archive`) to move the ticket into `_archive`.
- **Never auto-archive as part of the ship chain.** A shipped ticket **rests at `done`** until an explicit Next — the human pushes/deploys first, then archives.

## Report

End with one short status line the operator reads at a glance:
- **what you did** (which step(s) ran),
- **where the ticket is now** (its step),
- **the human's next action** — one of: *answer the N questions* (name them), *nothing — it advanced/shipped*, or *unblocked/blocked on X*.

## Notes

- **Process by default — DO NOT ask.** Running `lfad:next` MEANS "do the next thing." Never pause to ask the human "should I run add-test / ship / build?" — just run it, and report what happened after. The human's ONLY interaction points are the **gates** (answering questions). Once a gate is answered/approved, chain through EVERY downstream agent step automatically (e.g. `review`-approved → `add-test` → ship) and stop only at the next gate with open questions, a terminal, or a real block. A heavy or destructive tail (a slow test gate, a merge) is **not** a reason to stop and confirm — the step's own skill owns its safety (e.g. a local-merge-only ship, a green-gate-before-ship rule). Escalate mid-run ONLY on a genuine B-trigger (missing credential, a decision the gates never covered, a failure you can't resolve) — never for routine "are you sure?".
- **`skill:` vs `actions:`** — a step's `skill` binding is what `next` delegates to; a board can keep specific skills bound per step while exposing only `lfad:next` in `actions` (the single button). Reading `board.yml` live means `next` works for **any** pipeline shape, including custom steps added via `lfad:add-step`.
- **Respect the gate wall** — `next` is the *advance* affordance; **answering** a gate's questions is the separate question-flow affordance. `next` never invents a human's answer to clear a gate.
