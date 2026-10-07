---
name: absorb
summary: Land an external interview/QA result (a terminal deep-interview, a chat interview) into a ticket's interview/ file set — no re-asking.
description: >-
  The absorb step — take requirements that were crystallized OUTSIDE the board (a terminal `omc:deep-interview` run, its `.omc/specs/deep-interview-*.md` spec, or another QA/interview pass in chat) and write them into the ticket's `interview/` file set in the interview skill's exact contract: a restructured Understanding, `Resolved by agent:` lines for everything the interview settled, and ONLY the genuinely-residual forks as open question blocks — then rewrite the root `context.md`. Never re-asks what the source already answered. By default does NOT advance the gate (stops at interview for board confirmation). Auto-invoke when the user says "absorb the deep-interview into ticket N", "I interviewed in the terminal, save it to the ticket", "land these answers on ticket N", "sync the interview result", or runs /lfad:absorb. Question grammar, the interview/ contract, and movement mechanics defer to lfad:move and lfad:interview.
---

# lfad:absorb — land an external interview into the ticket

The board's `lfad:interview` is not the only place requirements get crystallized. A user may prefer the terminal's `omc:deep-interview` (its Socratic one-question-at-a-time flow with clarity scoring), or settle things in an ordinary chat/QA pass. **absorb is the bridge:** it writes that external result into the ticket's `interview/` file set in the **exact same shape** `lfad:interview` produces, so the pipeline picks it up with no re-asking and no special-casing downstream.

It is deliberately the interview skill's twin: same output contract (§ *The interview/ file set* in `lfad:interview`), same gate. The only difference is the **source** of the understanding — imported, not interviewed live here.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes, and **honor the board's guidance** in every human-facing file. The ticket should be at (or move to, per pull-validate) the `interview` step.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

## 1. Take the source

One of:

- **A deep-interview spec** — `.omc/specs/deep-interview-{slug}.md` (the artifact `omc:deep-interview` writes). If the user names a slug/path, read that; otherwise glob `.omc/specs/deep-interview-*.md` and confirm which one maps to this ticket by topic.
- **A live terminal deep-interview** — if the user wants to interview now, run `omc:deep-interview` in the terminal to produce the spec, then absorb it. (absorb does not re-implement the interview; it consumes its output.)
- **A chat/QA transcript** — answers the user gave in this session or another QA pass. Treat the decisions as settled input.

Read `context.md` and the `research/` set first — the source's decisions land against the current system, not in a vacuum.

## 2. Map the source into the interview contract

Translate, never transcribe. The source is evidence; the `interview/` files are the board's canonical record.

- **Understanding** → `interview/00-summary.md`: a restructured, human-explain-style Understanding (per `lfad:interview` rule 1 — never the spec text or idea copied back), grounded in the research paths.
- **Everything the source settled** → `Resolved by agent:` lines in `00-summary.md` (implementation / structure / code-level decisions) **or**, when a decision maps to a real fork the human owns, a **pre-answered** `**Decision:** <answer> ·YYYY-MM-DD` line in `01-questions.md`. Either way it is **not** an open question — the source already answered it, so the human never sees it again.
- **Only genuinely-residual forks** → open question blocks in `interview/01-questions.md`, in the canonical grammar (`lfad:move`) and shaped like deep-interview probes (one concept per block, target the weakest dimension, concrete `options` + free-text). If the source resolved everything, there are **zero** open blocks.
- **Round log** → seed `00-summary.md` with a single line noting the import and an honest `Clarity: NN%` mark (e.g. `Round 1 — absorbed from deep-interview ({slug}) — Clarity: 85% (…)`).

Write each file via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"interview/00-summary.md","content":…}`); daemon down → write into the ticket folder directly.

On every exit, including one with residual forks, rewrite the CURRENT-STATE block at the top of `<ticket>/context.md` per the canonical definition in `lfad:move`, with the imported state and the next interview confirmation action.

## 3. Rewrite context.md

If the absorb leaves the interview effectively settled (zero residual open blocks and Clarity at/above ~80%), **fully rewrite `<ticket>/context.md`** exactly as `lfad:interview`'s *When the gate clears* rule dictates: English, ~150-line hard cap, only paths/symbols/settled decisions/hard constraints, every imported decision folded in as plain final state. Include the CURRENT-STATE block at the top per the canonical definition in `lfad:move`, rewritten for the absorb exit and the next interview confirmation action.

## 4. Finish: complete in place, do NOT auto-advance

absorb is a **write**, not a move. **Default: it does not advance the gate** — the ticket stays at `interview` so the human confirms the imported understanding on the board (input mode) before it flows on. Apply `lfad:move`'s push-stop rule: complete in place, then state plainly:

- what was imported and from where,
- the current `Clarity` mark and any residual open blocks (with where they live),
- the next command the human runs once satisfied — the discuss loop (`/lfad:interview <id>`) if blocks remain, or the forward pull (`/lfad:mock <id>` when `needsDesign`, else `/lfad:todo <id>`) once the gate is clear.

Only advance the ticket yourself if the user explicitly asks absorb to carry it forward.
