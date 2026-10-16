---
name: design
summary: The styled HTML design over the approved mock structure.
description: The Design step playbook — a human gate that applies only to needsDesign tickets (skipUnless). Takes the approved mock structure and produces the styled HTML design (typography, color, spacing, states) in the ticket's design/ subfolder, served sandboxed by the daemon; the mandatory design/00-summary.md links the .html files, embeds screenshots, and carries the ## Approval slot the human answers. Auto-invoke when a needsDesign ticket reaches the design step, when the user says "design ticket N", "style the mock", "produce the design", or runs /lfad:design. Question format and movement mechanics defer to lfad:move.
---

# lfad:design — the look, on the approved bones

Design turns the approved mock structure into the visual contract the build implements: real typography, color, spacing, and states, still as self-contained HTML. Input: `context.md`, the approved `mock/` set, the `interview/` decisions. Output: the **`design/` file set** — styled `.html` design(s) plus the `00-summary.md` the human approves at this gate.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes; apply its **pull-validate** rule before moving the ticket in — the prior gates are **mock** (Approval slot answered, or the step skipped/fast-passed for this ticket) and **interview** behind it. This step carries `skipUnless: needsDesign`: invoked on a ticket without the flag → do no design work; say the step does not apply and point at `lfad:todo`.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

**Read `context.md` first**, then the mock, interview, and research sets. **Write every file by `../move/wording.md`, which layers the board's `writing`, `guidance` and `localRules` over the plugin defaults**.

## The work

- **The mock's approved structure is a contract.** Style it; do not rearrange it. A structural change this step surfaces (something the styling proves wrong) goes to the human as a question block — never a silent redesign.
- **Design within the target project's system.** Read the code repo's design tokens, component conventions, and any design guardrails the repo declares (its CLAUDE.md / design docs — the research set and `context.md` name them); the design must be buildable with what exists, and deviations are decisions to surface, not improvisations.
- Cover the **states that will exist** — default, empty, loading, error, dark/light where the project supports them — in as few files as honestly needed.
- Every design is **self-contained HTML** (inline CSS/JS, assets as data URIs) — the daemon serves ticket `.html` allowlisted and CSP-sandboxed (`GET /api/tickets/:id/files/design/<name>.html`); nothing external will load.

## The design/ file set

Write into the ticket's `design/` subfolder: designs as `NN-<slug>.html`, notes as `NN-<slug>.md` (numbering from `00`; 2+ files require the `00-summary.md` entry point). Screenshots go in `<ticket>/images/`.

**The board's content rail lists only `.md` files**, so `design/00-summary.md` is the human's window: per design, what it shows and the visual decisions it embodies (tokens used, deviations proposed), a screenshot embedded from `../images/`, and a relative link to the live file (`01-<slug>.html`). It ends with the `## Approval` slot — an `approve` question block with an empty `**Decision:**` line, per the canonical grammar in `lfad:move`. A genuine visual fork (two treatments to choose between) gets its own question block above it.

Rework loop: the human rejects or comments → revise the same `NN-` files in place (stable numbering), refresh screenshots, leave a fresh empty Approval line.

Write each file via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"design/00-summary.md","content":…}`); daemon down → write into the ticket folder directly.

On every exit, including a pass still awaiting approval, rewrite the CURRENT-STATE block at the top of `<ticket>/context.md` per the canonical definition in `lfad:move`, with the current design state and the next human or agent action.

## When approved: rewrite context.md

The pass whose end state is *approved* — the Approval slot (and any treatment questions) answered — **fully rewrites `<ticket>/context.md`** (never append; English; ~150-line cap; paths/symbols/settled decisions/hard constraints only). Include the CURRENT-STATE block at the top per the canonical definition in `lfad:move`, rewritten for the approved design exit and the next todo action. Add the settled visual decisions (tokens, patterns, the design file paths) as plain final state, so lfad:todo and lfad:build inherit the contract without reopening it.

## Finish: complete in place

Design is a **gate** — per `lfad:move`'s push-stop rule: **complete in place**. The ticket stays at design; the human answers the Approval slot on the board (input mode) or inline with the agent working the ticket, and `lfad:todo`'s pull-validate carries it forward. State plainly what is ready to review, where the designs live, and the next command.
