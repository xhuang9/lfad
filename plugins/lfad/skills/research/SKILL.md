---
name: research
summary: Ground the ticket in evidence — codebase exploration plus recorded-source online research.
description: The Research step playbook — explore the codebase (parallel sub-agent exploration allowed) and, when it positively impacts quality, the web (sources recorded), then write the research/ file set of key findings, component paths, and doc paths, rewrite the ticket's root context.md, and push the ticket forward to the interview gate. Agent-only, no human gate. Auto-invoke when a ticket enters the research step, when the user says "research ticket N", "run the research step", "explore the ticket", or runs /lfad:research. Movement mechanics defer to lfad:move.
---

# lfad:research — evidence before questions

Research exists so the interview asks sharp questions and the build starts on known ground. Input: the ticket body (the structured intent from lfad:idea). Output: the **`research/` file set** — key findings, component paths, doc paths — plus a fresh **`context.md`**. This step is **agent-only**: no human gate, nothing to approve; it completes and the ticket travels on to the interview gate.

Resolve the board, daemon, and CLI exactly as **`lfad:move`** describes; apply its **pull-validate** rule before moving the ticket in (on the default board no gate precedes research, so usually: move in with a reason and begin).

Acquire the running claim before work and release it on exit, per `lfad:move` (or reuse the enclosing `lfad:next` chain's token).

**Honor the board's guidance and word every file by `../move/wording.md`** per `lfad:move` — read it before writing and follow it in every human-facing file — language, format, tone. Code, frontmatter, filenames, and `context.md` stay English regardless.

## The work

1. **Read the ticket body** — the Rough idea is the brief; Scope/Risks/Dependencies are the first leads.
2. **Explore the codebase.** Find what the intent implicates: the components and modules it touches (exact paths), their callers, existing tests, adjacent patterns worth copying, and the project docs that govern the area. **Parallel sub-agent exploration is allowed** — fan out independent explorations when the surface is wide, then consolidate.
3. **Research online when it positively impacts quality** — an unfamiliar SDK, a standards question, prior art worth stealing. Never for what the code already answers. **Record every source**: each externally-sourced claim in the findings carries its URL.
4. **Separate fact from judgment.** Findings state what IS (cite file/symbol/URL); open questions and forks are *named*, not answered — answering them is the interview's job. A fork you spot here becomes interview ammunition, so state it crisply.

## The research/ file set

Write this step's files into the ticket's `research/` subfolder as `NN-<slug>.md` (numbering from `00`, next free NN). A step folder holding **2+ files MUST have a `00-summary.md` entry point**. Images (architecture sketches, screenshots) go in `<ticket>/images/`, referenced relatively (`../images/name.png`). Everything appears in the board's content rail, grouped under the research step.

- **`00-summary.md`** — key findings (one line each, cited), the component/doc path map, named open forks for the interview, and sources.
- **`NN-<topic>.md`** — one file per deep-dive topic when the ticket warrants more than the summary. A small ticket is honestly one `00-summary.md`.

Write each file via `PUT /api/tickets/:id/artifact` with its relative path (`{"name":"research/00-summary.md","content":…}` — the route accepts nested paths and creates the folder); daemon down → write into the ticket folder directly.

## Rewrite context.md

`<ticket>/context.md` is the root-level living brief every downstream step reads **first**. At this step's completion boundary, **fully rewrite it** (never append): English, hard cap ~150 lines, only file paths, symbols, settled decisions, and hard constraints — no prose history, no narrative. Include the CURRENT-STATE block at the top per the canonical definition in `lfad:move`, rewritten for the research exit and next interview action. After research it typically holds: the component paths and doc paths found, the constraints the code already imposes, and any facts that eliminate options. Write it via `PUT /api/tickets/:id/artifact` (`{"name":"context.md", …}`).

## Finish: push forward

Research is an `agent` step — apply the **push-stop** rule from `lfad:move`: research is not a gate, so on completion the ticket **moves forward** to the next applicable step with a reason (on the default board: `interview`, a gate — the ticket waits there for the interview pass and the human). In a daemon run, signal per the run prompt's sentinel protocol (`FLOW_DONE` after the files are written; the engine performs the advance).
