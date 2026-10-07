---
name: mock
summary: Low-fi HTML mocks that settle structure and placement before any styling.
description: The Mock step playbook — a human gate that applies only to needsDesign tickets (skipUnless). Produces low-fidelity HTML mock file(s) in the ticket's mock/ subfolder — boxes, labels, real content hierarchy, zero styling — served sandboxed by the daemon; the mandatory mock/00-summary.md links the .html files, embeds screenshots, and carries the ## Approval slot the human answers. Auto-invoke when a needsDesign ticket reaches the mock step, when the user says "mock ticket N", "make the low-fi mock", "wireframe the ticket", or runs /lfad:mock. Question format and movement mechanics defer to lfad:move.
---

# lfad:mock — settle the layout cheaply

Mock buys structural agreement before styling effort: low-fi HTML the human can open, click through, and approve or redirect. Input: `context.md`, the cleared `interview/` set, and `research/`. Output: the **`mock/` file set** — one or more `.html` mocks plus the `00-summary.md` the human approves at this gate.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes; apply its **pull-validate** rule before moving the ticket in — the nearest prior gate is **interview** (zero open question blocks, latest round's Clarity at/above threshold). This step carries `skipUnless: needsDesign`: it applies only to tickets whose `needsDesign` flag is truthy. Invoked on a ticket without the flag → do no mock work; say the step does not apply and point at `lfad:todo`.

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

**Read `context.md` first**, then the interview and research sets. **Honor the board's guidance** per `lfad:move` in every human-facing file — language, format, tone. Code, filenames, and `context.md` stay English.

## The work

- **Low-fi means structure only**: boxes, labels, real content hierarchy and real (or realistic) copy, grayscale, default fonts — zero visual polish. The question a mock answers is *what exists where*, never *how it looks* (that is lfad:design's gate).
- Build **one mock per distinct surface or state** that the interview settled (a page, a modal, an empty state). Competing layouts the human should choose between are separate mocks, offered as a question.
- Every mock is **self-contained HTML** (inline CSS/JS, no external requests) — the daemon serves ticket `.html` files allowlisted and CSP-sandboxed (`GET /api/tickets/:id/files/mock/<name>.html`), so nothing outside the file will load.

## The mock/ file set

Write into the ticket's `mock/` subfolder: mocks as `NN-<slug>.html`, notes as `NN-<slug>.md` (numbering from `00`; 2+ files require the `00-summary.md` entry point — with the `.html` alongside it, that is effectively always). Screenshots go in `<ticket>/images/`.

**The board's content rail lists only `.md` files** — the `.html` mocks do not appear on their own, so `mock/00-summary.md` is the human's window into them:

```markdown
# Mock — <ticket title>

## What to review
<One line per mock: what it shows and the structural choice it embodies.>

### 01 — <surface>
![](../images/mock-01.png)
Open it live: [01-<slug>.html](01-<slug>.html)

## Approval
```question
id: mock-approval
ask: Approve the mock structure? (Comment on the specific mock's section above to redirect.)
type: approve
```
**Decision:**
```

- Link each mock **relatively** from the summary (`01-<slug>.html`) and embed a screenshot from `../images/` so the rail shows the shape at a glance.
- A genuine structural fork (two competing layouts) gets its own question block above the Approval slot — format per the canonical grammar in `lfad:move`.
- Rework loop: the human rejects or comments → revise the same `NN-` files in place (stable numbering), refresh the screenshots, and leave a fresh empty Approval `Decision:` line.

Write each file via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"mock/01-home.html","content":…}` — the route accepts nested paths); daemon down → write into the ticket folder directly.

On every exit, including a pass still awaiting approval, rewrite the CURRENT-STATE block at the top of `<ticket>/context.md` per the canonical definition in `lfad:move`, with the current mock state and the next human or agent action.

## When approved: rewrite context.md

The pass whose end state is *approved* — the Approval slot (and any layout questions) answered, whether interactively or found answered on re-invocation — **fully rewrites `<ticket>/context.md`** (never append; English; ~150-line cap; paths/symbols/settled decisions/hard constraints only). Include the CURRENT-STATE block at the top per the canonical definition in `lfad:move`, rewritten for the approved mock exit and the next design action. Add the settled structural decisions and the mock file paths as plain final state.

## Finish: complete in place

Mock is a **gate** — per `lfad:move`'s push-stop rule: **complete in place**. The ticket stays at mock; the human answers the Approval slot on the board (input mode) or inline with the agent working the ticket, and `lfad:design`'s pull-validate carries it forward. State plainly what is ready to review, where the mocks live, and the next command.
