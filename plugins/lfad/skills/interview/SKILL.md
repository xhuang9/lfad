---
name: interview
summary: The planning-phase human gate — skipped by default; asks only real direction forks, each question self-contained.
description: >-
  The Interview step playbook — THE planning-phase human gate, skipped by default: most tickets clear it with zero questions. Renders a human-explain-style restructured understanding of the ticket (never the idea text copied back), decides implementation/structure/code-level questions itself ("Resolved by agent" lines), and puts ONLY information-architecture and overall-direction forks to the human as question blocks. Multi-round with a "Clarity: NN%" mark per round (threshold ~80%); below threshold the next round RE-DISTILLS into fewer, sharper questions, never more. Also the discuss loop: invoked on a ticket already at interview, it processes the human's answers, updates the files, and rewrites context.md once the gate clears. Auto-invoke when a ticket reaches the interview step, when the user says "interview ticket N", "run the interview", "I've answered the questions / process my answers", or runs /lfad:interview. Question format and movement mechanics defer to lfad:move.
---

# lfad:interview — converge understanding into decisions

Interview is **the** planning-phase human gate: everything after it (mock, design, todo, build) runs on what this step settles. Input: the ticket body, `context.md`, and the `research/` file set. Output: the **`interview/` file set** — a restructured understanding plus the open question blocks — kept alive across rounds until the gate clears.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes; apply its **pull-validate** rule before moving the ticket in (on the default board no gate precedes interview). Read `context.md` and `research/` before writing anything — question quality is bought with evidence.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

**Write every file by `../move/wording.md`, which layers the board's `writing`, `guidance` and `localRules` over the plugin defaults**.

## Skip by default

Most tickets need no interview. Do not go looking for questions. Read the evidence, decide everything you can, and ask only when a real direction fork remains that the ticket, research and code cannot settle.

When no such fork exists, which is the usual case, write `interview/00-summary.md` (Understanding, `Resolved by agent:` lines, `Round 1 — Clarity: NN% (no open forks)`), write no question file, rewrite `context.md` per "When the gate clears", and finish. The gate is cleared with zero open blocks, so the next `lfad:next` carries the ticket straight on. Say in your output that the interview cleared with no questions.

## Hard rules (the method — follow them literally)

1. **Render a restructured understanding, human-explain style.** Re-express the ticket as what will exist and how it meets the current system — process-level language, a diagram or table where it clarifies, grounded in the research paths. **Never copy the idea text back verbatim**: if your Understanding section could have been produced by quoting the ticket, it isn't understanding yet.
2. **Split the decision labor.** Implementation, structure, and code-level decisions are **yours**: decide them and record each as a `Resolved by agent: <decision — reason>` line (no slot, nothing for the human to answer). **Only information-architecture and overall-direction decisions become question blocks** — where things live, what the thing fundamentally is, what the user experiences, what the product promises.
3. **Every question must eliminate a real ambiguity.** Restating information the human already gave as a confirm-question is **BANNED**. So is any check of your own reading: "Is this right?", "Does this look correct?", "Are these the right components / is this the right scope?", "Shall I proceed?". The Understanding is there to read; a human who disagrees says so with `lfad:prompt`. Before writing a block, name (to yourself) the two readings it separates; if there is only one reading, there is no question. **If the idea or the user's instructions already settle a fork, it is not a question** — record it as a `Resolved by agent:` line (or, when it maps to an existing block, pre-answer that `Decision:` line), never surface it as an open block. The human's interactive surface stays lean: only what genuinely still needs them (the bl-human-reply principle — the long reasoning lives in the files, the questions stay short and load-bearing).
   - **Shape each block like a deep-interview probe:** target the single weakest / most-forking dimension, **one concept per block**, concrete `options` plus room for free-text; never batch multiple forks into one block.
4. **Score every round.** Each round ends with a one-line, honestly subjective `Clarity: NN% (<what's solid, what's fuzzy>)` mark, recorded in the round log. The threshold is **~80%**.
5. **Every question is self-contained.** The human answers from the question alone, without opening other tabs or files. The markdown directly above each block (its context, which the input form shows) must carry, in plain words:
   - what the decision is about and why it matters now;
   - the current behaviour or fact that creates the fork, stated in full (quote the one line of evidence; never "see research" or "see 00-summary");
   - what each option means and what changes downstream if it is picked;
   - your recommendation and the reason.
   Define every term the question uses. No labels defined elsewhere (`C1`, "the component above", "option B from round 1"). The `ask` line names the thing being decided, and each option reads as a complete choice on its own.
6. **Re-distill, never append.** Below threshold, the next round **replaces** the open question set with *fewer, sharper* questions — fold what the answers taught you back into the understanding and ask only what still forks. The open-block count must not grow round over round.

## Question format

Question blocks follow the **canonical grammar in `lfad:move`** — a fenced ```` ```question ```` block (YAML `id` / `ask` / `type` / `options`) followed by an empty `**Decision:**` line; answers arrive as `**Decision:** <answer> ·YYYY-MM-DD` from the board's input mode, an inline collection by the agent working the ticket, or a hand edit. Write each question's evidence and stakes as the markdown *above* its block — that markdown is the context the input UI shows.

## The interview/ file set

Write into the ticket's `interview/` subfolder as `NN-<slug>.md` (numbering from `00`); 2+ files require the `00-summary.md` entry point. Images in `<ticket>/images/` (`../images/name.png`).

- **`interview/00-summary.md`** — the entry point: the restructured Understanding (kept current every round), the `Resolved by agent:` list, and the **round log** (`Round N — Clarity: NN% (…)`, one line per round).
- **`interview/01-questions.md`** — the live question file. Answered blocks stay (their stamped `Decision:` lines are the record); each new round **rewrites the open blocks** into the re-distilled set. At any moment the open blocks in `interview/` are exactly the current round's questions — superseded open questions are removed, their substance folded into the sharper ones.

Write each file via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"interview/00-summary.md","content":…}`); daemon down → write into the ticket folder directly (an *edit* to an existing artifact routes through the daemon when it runs, which snapshots first).

On every exit, including an uncleared round, rewrite the CURRENT-STATE block at the top of `<ticket>/context.md` per the canonical definition in `lfad:move`, with the current Clarity/open-question state and the next interview action.

## Rounds: first pass and the discuss loop

**First pass** (no `interview/` files yet): explore evidence (research set + code), write `00-summary.md` (Understanding + agent-resolved decisions + `Round 1 — Clarity: NN%`) and `01-questions.md` with the round-1 blocks. Round 1 usually has zero questions (see "Skip by default"). When it has any, it carries the most it will ever have, still only direction/IA forks per rule 2.

**Discuss loop** (invoked on a ticket already at interview with answers in the files): treat the `Decision:` lines as the human's reply.

1. Re-read the set; process every answered block — align the Understanding, the agent-resolved list, and downstream implications with each answer, honoring written alternatives literally.
2. Score the round (`Clarity: NN%`) and append it to the round log.
3. **At/above ~80% and zero open blocks → the gate clears** (see below). At/above threshold with open blocks that answers made moot → resolve them yourself as agent-resolved lines and clear.
4. **Below threshold** → re-distill (rule 6): rewrite `01-questions.md`'s open set into fewer, sharper blocks and say plainly what round it is and what remains fuzzy.

**Two modes.** *Interactive* (`/lfad:interview 12` with a user present): run the rounds live in chat — present the understanding, ask the round's questions, and write the files with the given answers already on their `Decision:` lines; only genuinely unanswered forks stay open. *Board mode* (headless run): write the round's blocks and stop at the gate (`FLOW_DONE` after the files are written); answers arrive via the board (or an inline collection) and a later invocation runs the discuss loop.

**Seeding from an external interview.** When the requirements were crystallized elsewhere — a terminal `omc:deep-interview` run, or another QA pass — don't re-ask any of it: `/lfad:absorb <id>` lands that result into this same `interview/` file set (Understanding + `Resolved by agent:` lines + only the residual forks as open blocks) and rewrites `context.md`. Run the discuss loop afterwards to clear the gate.

## When the gate clears: rewrite context.md

The pass that leaves the interview cleared — zero open blocks and the latest round's Clarity at/above threshold — **fully rewrites `<ticket>/context.md`** (never append): English, ~150-line hard cap, only paths/symbols/settled decisions/hard constraints, no prose history. Include the CURRENT-STATE block at the top per the canonical definition in `lfad:move`, rewritten for the interview exit and the next applicable gate or todo action. Fold in every human decision and every `Resolved by agent` decision as plain final state.

## Finish: complete in place

Interview is a **gate** — apply `lfad:move`'s push-stop rule: **complete in place**. The ticket stays at interview; the human answers on the board (input mode) or inline when you're working the ticket, and the next step's pull-validate carries it forward — `lfad:mock` for `needsDesign` tickets, `lfad:todo` otherwise. State plainly in your output which questions await the human, the current Clarity mark, and that next command.
