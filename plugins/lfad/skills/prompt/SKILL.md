---
name: prompt
summary: Run a freeform user instruction against a ticket (or a pointed-at part), in the ticket's context, recording the prompt and result on the ticket.
description: The custom-prompt escape hatch — run an ad-hoc, freeform human instruction against a ticket at ANY step, scoped to the whole ticket or a pointed-at part (an artifact / section / quoted excerpt). Reads the ticket context, does the work (edit an artifact in place, change code in the ticket's worktree, or produce an analysis), and records both the prompt and the outcome as `prompt/` artifacts so the exchange lives on the ticket. By default it does not move the ticket, but when the instruction asks it moves the ticket to ANY step — forward or backward — via lfad:move (the ad-hoc move-to-any-step escape hatch: redo a stage, correct a wrong path; backward moves preserve the ticket's downstream artifacts). This is the general capability the fixed step-skills (idea/research/interview/todo/build/review) don't cover. Auto-invoke when the user says "prompt ticket N", "ask the agent to do X on ticket N", "custom prompt for this ticket", "work on this part of the ticket", "move ticket N back to <step> / to <step>", or runs /lfad:prompt. Movement mechanics defer to lfad:move.
---

# lfad:prompt — a custom prompt against a ticket

The fixed step-skills each do one structured job. `lfad:prompt` is the **escape hatch**: an arbitrary human instruction, run against a ticket in its own context, at any step, without being a pipeline stage. Board/daemon discovery and the write/commit rules live in **`lfad:move`**; follow its grammar. This skill defines only the custom-prompt work.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

Distinct from its neighbours: the board's **input mode** (the drawer's question flow at `/t/<id>/input`, the amber "? n" badge) collects a human's answer to a question the *agent* asked; **blocked** is the agent escalating a decision *to* the human. `lfad:prompt` is the inverse of both — the *human* handing the *agent* an ad-hoc instruction.

## Inputs

Three ways the instruction and its target arrive; take whichever is present:

1. **Inline** — the user runs `/lfad:prompt <id> <instruction>` (in chat or the copied command) and names the target in prose (e.g. "in `review.md`'s Awaiting your confirmation section, tighten the wording"). The drawer shows every artifact name + heading, so naming a section is enough.
2. **A pending prompt artifact** — the board's Prompt affordance (when present) writes `prompt/NN-{slug}.md` holding the reference (`file` + optional heading/anchor or a quoted excerpt) and the instruction. Read the newest one whose result note is missing.
3. **Chat** — the user states it conversationally; treat the current ticket + open section as the target.

**Resolve the target scope**: a named artifact/section/quote → focus there; nothing named → the whole ticket. Always read **`context.md`** and the referenced artifact(s) first so the work respects what was already decided.

## Do the work

Match the action to the instruction; keep the ticket's existing contracts intact:

- **Artifact / doc edit** (rewrite a section, restructure a note, tighten copy) → edit the artifact via `PUT /api/tickets/:id/artifact`. **Never overwrite an answered gate slot** (a `**Decision:**` line the human filled, an `## Approval`) or a question block, unless the instruction is explicitly about it — the gate contracts outrank a casual prompt.
- **Code work** (change/extend the implementation) → work in the ticket's **worktree** (provision it as `lfad:build` does if absent; reuse it if present) under the target repo's own CLAUDE.md/guardrails. Leave a clean dry-run diff, or commit inside the worktree when `LFAD_DRY_RUN` is off. Push nothing.
- **Analysis / answer** (explain, compare, propose) → produce the answer as the result note below; change nothing else.

**Build only what the instruction asks.** A prompt that implies new scope, a strategy change, or a decision the pipeline never made is a **B-escalation** (surface it — inline ask, or `FLOW_BLOCK` in a daemon run), not a silent judgment call.

## Record the exchange

Both the prompt and its outcome live on the ticket (audit trail, survives sessions). Write under `prompt/` (**Honor the board's guidance** — language/tone; code/paths English):

- **`prompt/NN-{slug}.md`** — the instruction + its reference (the target artifact/section/quote), if not already written by the UI.
- **`prompt/NN-{slug}.result.md`** — what you did: the edits/commits (hashes or dry-run diff state), the analysis, or the answer. Reference any worktree diff (`git -C <worktree> diff`) rather than pasting it.

Number from the next free `NN` in `prompt/`. Put images in `<ticket>/images/` and reference them relatively.

## Move the ticket only when the instruction asks

A custom prompt is orthogonal to the pipeline — **by default it does not move the ticket.** When the instruction says nothing about relocating it, leave the ticket where it is and report what you did. Never move on your own initiative: a move the human didn't ask for is a B-escalation, not a silent judgment call.

But `lfad:prompt` **is** the ad-hoc move-to-any-step escape hatch. When the human's instruction asks to relocate the ticket — "move this back to interview and re-open the questions", "jump it to doing", "send it back to design and redo it" — perform that move via `lfad:move` grammar, to **any step, forward or backward**, **after** recording the prompt/result, and say so. There is no dedicated move-to-step picker; a freeform prompt is how a human skips ahead, redoes a stage, or corrects a wrong path.

**A backward move preserves the ticket's downstream artifacts.** A move is a pure folder rename — `moveTicket()` / `relocateTicket()` (`packages/core/src/fileops.ts`) only change `status` / `history` / `updatedAt`; nothing reads, warns about, or clears artifact files. Every downstream artifact (`design/`, past `interview/`, `doing/`, …) lives inside the ticket folder, so it travels with the rename untouched and stays visible in the sidebar. Moving `design → interview` re-opens the interview stage **without discarding the design work** — the prompt itself is what tells the agent which stage to redo (e.g. "re-open the interview questions").

**`lfad:next` still guards gates.** A ticket moved back to a gate step (e.g. `interview`) whose question blocks are unanswered will not advance under `lfad:next` until the human answers — the backward move re-opens the stage, it does not let the pipeline skip the gate. So a manual backward move is safe: the pipeline picks up from the re-opened stage and stops at the first unresolved gate as usual.
